import "./ContextPill.css";
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
    <div className="cp-root">
      {activeFiles.map((name) => {
        const basename = name.includes("/") ? name.split("/").pop() : name;
        return (
        <span
          key={name}
          title={`schema: ${name}`}
          className="cp-pill"
        >
          schema: {basename}
          <button
            onClick={() => removeActiveFile(name)}
            className="cp-remove"
          >
            x
          </button>
        </span>
        );
      })}
    </div>
  );
}
