"use client";

import { useState } from "react";

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: "People",
    emojis: [
      "👩", "👨", "👧", "👦", "👶", "🧒", "👩‍🦰", "👨‍🦰", "👩‍🦱", "👨‍🦱",
      "👩‍🦳", "👨‍🦳", "👩‍🦲", "👨‍🦲", "🧔", "👵", "👴", "👸", "🤴", "🧕",
      "👮", "👷", "💂", "🕵️", "👩‍⚕️", "👩‍🎓", "👩‍🏫", "👩‍⚖️", "👩‍🌾", "👩‍🍳",
      "👩‍🔧", "👩‍🏭", "👩‍💼", "👩‍🔬", "👩‍💻", "👩‍🎤", "👩‍🎨", "👩‍✈️", "👩‍🚀", "👩‍🚒",
      "🤶", "🎅", "🦸", "🦹", "🧙", "🧚", "🧛", "🧜", "🧝", "🧞",
      "🙋", "🙋‍♂️", "🙋‍♀️", "💁", "💁‍♂️", "💁‍♀️", "🙇", "🤷", "🤦", "🧏",
    ],
  },
  {
    label: "Animals",
    emojis: [
      "🐕", "🐈", "🐦", "🐠", "🐢", "🐇", "🐹", "🐍", "🐒", "🦊",
      "🦁", "🐯", "🐻", "🐼", "🐨", "🐸", "🐷", "🐮", "🐔", "🐴",
      "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🦅", "🦆", "🦉", "🐺",
      "🐗", "🦇", "🦎", "🐙", "🦀", "🐬", "🐳", "🦈", "🐊", "🐘",
    ],
  },
  {
    label: "Places",
    emojis: [
      "🏠", "🏡", "🏢", "🏣", "🏥", "🏦", "🏨", "🏩", "🏪", "🏫",
      "🏬", "🏭", "🏯", "🏰", "🗼", "⛪", "🕌", "🛕", "⛩️", "🕍",
      "🏗️", "🏘️", "🏚️", "🏙️", "🌆", "🌇", "🌃", "🌉", "🎪", "🗽",
    ],
  },
  {
    label: "Objects",
    emojis: [
      "📹", "📷", "📸", "🎥", "📺", "📻", "🎙️", "🎚️", "🎛️", "💻",
      "🖥️", "⌨️", "🖨️", "📱", "📲", "☎️", "📡", "🔌", "💡", "🔦",
      "🕯️", "🧯", "🛢️", "🔧", "🔨", "⚙️", "🔩", "🗜️", "🔑", "🗝️",
    ],
  },
  {
    label: "Rooms",
    emojis: [
      "🍳", "🛋️", "🛏️", "💻", "🚿", "☀️", "🚗", "🏠", "🏭", "🏥",
      "🚪", "🪑", "🛁", "🪞", "🧹", "🧴", "🏋️", "🎮", "📚", "🎵",
    ],
  },
  {
    label: "Symbols",
    emojis: [
      "⭐", "🌟", "💫", "✨", "🔥", "💧", "🌈", "☀️", "🌙", "⚡",
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🤎", "🖤", "🤍", "💖",
      "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "🟤", "⚫", "⚪", "📍",
    ],
  },
];

interface EmojiPickerProps {
  selected: string;
  onSelect: (emoji: string) => void;
  label?: string;
}

export default function EmojiPicker({ selected, onSelect, label }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);

  return (
    <div>
      {label && (
        <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--gh-text-muted)" }}>
          {label}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition"
        style={{
          backgroundColor: "var(--gh-card)",
          border: "1px solid var(--gh-border)",
          color: "var(--gh-text)",
        }}
      >
        <span className="text-2xl">{selected}</span>
        <span style={{ color: "var(--gh-text-muted)" }}>
          {open ? "Close" : "Choose Emoji"}
        </span>
      </button>
      {open && (
        <div
          className="mt-2 rounded-xl p-3 shadow-lg"
          style={{
            backgroundColor: "var(--gh-surface)",
            border: "1px solid var(--gh-border)",
            maxHeight: 280,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="flex gap-1 mb-2 overflow-x-auto pb-1" style={{ minHeight: 28 }}>
            {EMOJI_CATEGORIES.map((cat, i) => (
              <button
                key={cat.label}
                type="button"
                onClick={() => setActiveCategory(i)}
                className="px-2 py-0.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition"
                style={{
                  backgroundColor: activeCategory === i ? "rgba(91,156,246,0.12)" : "transparent",
                  color: activeCategory === i ? "var(--gh-blue)" : "var(--gh-text-muted)",
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-8 gap-1 overflow-y-auto flex-1">
            {EMOJI_CATEGORIES[activeCategory].emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => { onSelect(emoji); setOpen(false); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-lg hover:bg-black/5 transition"
                style={selected === emoji ? { backgroundColor: "rgba(91,156,246,0.15)", outline: "1px solid var(--gh-blue)" } : {}}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
