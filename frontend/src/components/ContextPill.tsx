import { useEffect, useRef } from "react";
import { useStore } from "../store";

interface ContextPillProps {
  inputText?: string;
}

export default function ContextPill({ inputText }: ContextPillProps) {
  const { activeFiles, files, addActiveFile, removeActiveFile } = useStore();

  // Priority-4: Move addActiveFile side-effect into useEffect
  const prevInput = useRef(inputText);
  useEffect(() => {
    if (!inputText || inputText === prevInput.current) return;
    prevInput.current = inputText;

    const mentions = inputText.match(/@(\S+)/g);
    if (!mentions) return;

    for (const mention of mentions) {
      const name = mention.slice(1); // strip @
      const match = files.find(
        (f) => f.name === name || f.name.startsWith(name)
      );
      if (match && !activeFiles.includes(match.name)) {
        addActiveFile(match.name);
      }
    }
  }, [inputText, files, activeFiles, addActiveFile]);

  if (activeFiles.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        padding: "4px 0",
      }}
    >
      {activeFiles.map((name) => {
        const basename = name.includes("/") ? name.split("/").pop() : name;
        return (
        <span
          key={name}
          title={`schema: ${name}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            fontSize: 'var(--font-size-xs)',
            fontFamily: "var(--font-mono)",
            color: "var(--accent)",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--accent-dimmed)",
            lineHeight: "18px",
            whiteSpace: "nowrap",
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          schema: {basename}
          <button
            onClick={() => removeActiveFile(name)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dimmed)",
              cursor: "pointer",
              fontSize: 'var(--font-size-xs)',
              padding: 0,
              lineHeight: 1,
              fontFamily: "var(--font-mono)",
            }}
          >
            x
          </button>
        </span>
        );
      })}
    </div>
  );
}
