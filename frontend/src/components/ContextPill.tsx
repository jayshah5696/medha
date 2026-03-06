import { useStore } from "../store";

interface ContextPillProps {
  inputText?: string;
}

export default function ContextPill({ inputText }: ContextPillProps) {
  const { activeFiles, files, addActiveFile, removeActiveFile } = useStore();

  // Parse @mentions from input text and add matching files
  if (inputText) {
    const mentions = inputText.match(/@(\S+)/g);
    if (mentions) {
      for (const mention of mentions) {
        const name = mention.slice(1); // strip @
        const match = files.find(
          (f) => f.name === name || f.name.startsWith(name)
        );
        if (match && !activeFiles.includes(match.name)) {
          addActiveFile(match.name);
        }
      }
    }
  }

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
      {activeFiles.map((name) => (
        <span
          key={name}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--accent)",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--accent-dimmed)",
            lineHeight: "18px",
            whiteSpace: "nowrap",
          }}
        >
          schema: {name}
          <button
            onClick={() => removeActiveFile(name)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dimmed)",
              cursor: "pointer",
              fontSize: 10,
              padding: 0,
              lineHeight: 1,
              fontFamily: "var(--font-mono)",
            }}
          >
            x
          </button>
        </span>
      ))}
    </div>
  );
}
