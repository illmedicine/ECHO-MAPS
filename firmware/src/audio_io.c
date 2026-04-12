/**
 * Audio I/O — FNK0086 I2S microphone + DAC speaker
 *
 * Captures audio for room acoustic fingerprinting during calibration.
 * Speaker provides audio feedback for user actions.
 */

#include "audio_io.h"

#include <string.h>
#include <math.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_tls.h"
#include "driver/i2s_std.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "audio";

/* FNK0086 I2S pin assignments */
#define I2S_MIC_SCK    GPIO_NUM_42
#define I2S_MIC_WS     GPIO_NUM_41
#define I2S_MIC_SD     GPIO_NUM_2

#define I2S_SPK_SCK    GPIO_NUM_42
#define I2S_SPK_WS     GPIO_NUM_41
#define I2S_SPK_SD     GPIO_NUM_40

#define MIC_SAMPLE_RATE  16000   /* 16kHz for voice/ambient */
#define MIC_BITS         16

static i2s_chan_handle_t mic_handle = NULL;
static i2s_chan_handle_t spk_handle = NULL;

void audio_init(void) {
    /* Microphone channel (RX) */
    i2s_chan_config_t mic_chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    i2s_new_channel(&mic_chan_cfg, NULL, &mic_handle);

    i2s_std_config_t mic_std_cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(MIC_SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = I2S_MIC_SCK,
            .ws   = I2S_MIC_WS,
            .dout = I2S_GPIO_UNUSED,
            .din  = I2S_MIC_SD,
        },
    };
    i2s_channel_init_std_mode(mic_handle, &mic_std_cfg);
    i2s_channel_enable(mic_handle);

    /* Speaker channel (TX) */
    i2s_chan_config_t spk_chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
    i2s_new_channel(&spk_chan_cfg, &spk_handle, NULL);

    i2s_std_config_t spk_std_cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(MIC_SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = I2S_SPK_SCK,
            .ws   = I2S_SPK_WS,
            .dout = I2S_SPK_SD,
            .din  = I2S_GPIO_UNUSED,
        },
    };
    i2s_channel_init_std_mode(spk_handle, &spk_std_cfg);
    i2s_channel_enable(spk_handle);

    ESP_LOGI(TAG, "Audio I/O initialized (mic: %dHz, %d-bit)", MIC_SAMPLE_RATE, MIC_BITS);
}

audio_sample_t *audio_capture_snippet(uint32_t duration_ms) {
    if (!mic_handle) return NULL;

    uint32_t n_samples = (MIC_SAMPLE_RATE * duration_ms) / 1000;
    size_t buf_size = n_samples * sizeof(int16_t);

    audio_sample_t *sample = malloc(sizeof(audio_sample_t));
    if (!sample) return NULL;

    sample->samples = heap_caps_malloc(buf_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!sample->samples) {
        sample->samples = malloc(buf_size);
    }
    if (!sample->samples) {
        free(sample);
        return NULL;
    }

    sample->timestamp = esp_timer_get_time();

    /* Read from I2S mic */
    size_t bytes_read = 0;
    size_t total_read = 0;
    uint8_t *dst = (uint8_t *)sample->samples;

    while (total_read < buf_size) {
        size_t chunk = buf_size - total_read;
        if (chunk > 1024) chunk = 1024;
        i2s_channel_read(mic_handle, dst + total_read, chunk, &bytes_read, pdMS_TO_TICKS(100));
        total_read += bytes_read;
    }

    sample->n_samples = n_samples;
    sample->sample_rate = MIC_SAMPLE_RATE;
    sample->duration_ms = duration_ms;

    ESP_LOGD(TAG, "Captured %lu audio samples (%lums)", (unsigned long)n_samples, (unsigned long)duration_ms);
    return sample;
}

void audio_free_sample(audio_sample_t *sample) {
    if (sample) {
        free(sample->samples);
        free(sample);
    }
}

void audio_play_tone(uint32_t freq_hz, uint32_t duration_ms) {
    if (!spk_handle) return;

    uint32_t n_samples = (MIC_SAMPLE_RATE * duration_ms) / 1000;
    int16_t *buf = malloc(n_samples * sizeof(int16_t));
    if (!buf) return;

    /* Generate sine wave */
    for (uint32_t i = 0; i < n_samples; i++) {
        float t = (float)i / MIC_SAMPLE_RATE;
        buf[i] = (int16_t)(16000.0f * sinf(2.0f * 3.14159f * freq_hz * t));
    }

    size_t bytes_written = 0;
    i2s_channel_write(spk_handle, buf, n_samples * sizeof(int16_t), &bytes_written, pdMS_TO_TICKS(duration_ms + 100));
    free(buf);
}

void bridge_send_audio_sample(void *tls, audio_sample_t *sample, const char *room_name) {
    if (!tls || !sample) return;

    /*
     * Audio sample packet (IL protocol v2):
     *   [magic(2B)][version(1B)][event=0x11(1B)][seq(4B)][payload_len(4B)]
     *   [timestamp(8B)][sample_rate(4B)][n_samples(4B)]
     *   [room_name_len(1B)][room_name(N)][pcm_data]
     *   [crc32(4B)]
     */
    uint8_t room_len = strlen(room_name);
    if (room_len > 63) room_len = 63;

    uint32_t pcm_bytes = sample->n_samples * sizeof(int16_t);
    uint32_t payload_len = 8 + 4 + 4 + 1 + room_len + pcm_bytes;

    uint8_t header[12];
    header[0] = 0x49; header[1] = 0x4C;
    header[2] = 0x02;
    header[3] = 0x11;  /* AUDIO_SAMPLE event */

    static uint32_t audio_seq = 0;
    audio_seq++;
    header[4] = (audio_seq >> 24) & 0xFF;
    header[5] = (audio_seq >> 16) & 0xFF;
    header[6] = (audio_seq >> 8)  & 0xFF;
    header[7] = audio_seq & 0xFF;

    header[8]  = (payload_len >> 24) & 0xFF;
    header[9]  = (payload_len >> 16) & 0xFF;
    header[10] = (payload_len >> 8)  & 0xFF;
    header[11] = payload_len & 0xFF;

    esp_tls_conn_write((esp_tls_t *)tls, header, 12);

    /* Timestamp */
    uint8_t ts_buf[8];
    int64_t ts = sample->timestamp;
    for (int i = 0; i < 8; i++) ts_buf[i] = (ts >> (56 - i * 8)) & 0xFF;
    esp_tls_conn_write((esp_tls_t *)tls, ts_buf, 8);

    /* Sample rate + count */
    uint8_t meta[8];
    uint32_t sr = sample->sample_rate;
    meta[0] = (sr >> 24) & 0xFF; meta[1] = (sr >> 16) & 0xFF;
    meta[2] = (sr >> 8) & 0xFF;  meta[3] = sr & 0xFF;
    uint32_t ns = sample->n_samples;
    meta[4] = (ns >> 24) & 0xFF; meta[5] = (ns >> 16) & 0xFF;
    meta[6] = (ns >> 8) & 0xFF;  meta[7] = ns & 0xFF;
    esp_tls_conn_write((esp_tls_t *)tls, meta, 8);

    /* Room name */
    esp_tls_conn_write((esp_tls_t *)tls, &room_len, 1);
    esp_tls_conn_write((esp_tls_t *)tls, (const unsigned char *)room_name, room_len);

    /* PCM data */
    esp_tls_conn_write((esp_tls_t *)tls, (uint8_t *)sample->samples, pcm_bytes);

    ESP_LOGD(TAG, "Sent audio: %lu samples, room=%s", (unsigned long)sample->n_samples, room_name);
}
