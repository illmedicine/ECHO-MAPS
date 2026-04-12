/**
 * Audio I/O module for Illy Bridge — FNK0086 I2S mic + speaker
 */
#pragma once

#include <stdint.h>

typedef struct {
    int16_t  *samples;      /* PCM 16-bit mono samples */
    uint32_t  n_samples;    /* Number of samples */
    uint32_t  sample_rate;  /* Sample rate (Hz) */
    uint32_t  duration_ms;  /* Duration in milliseconds */
    int64_t   timestamp;    /* Capture timestamp (microseconds) */
} audio_sample_t;

/* Initialize I2S mic and speaker */
void audio_init(void);

/* Capture an audio snippet of given duration (ms) */
audio_sample_t *audio_capture_snippet(uint32_t duration_ms);

/* Free captured audio sample */
void audio_free_sample(audio_sample_t *sample);

/* Play a tone through speaker (for audio feedback) */
void audio_play_tone(uint32_t freq_hz, uint32_t duration_ms);

/* Send audio sample to cloud via TLS */
void bridge_send_audio_sample(void *tls, audio_sample_t *sample, const char *room_name);
