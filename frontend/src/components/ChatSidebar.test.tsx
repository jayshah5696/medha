import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ChatSidebar from "./ChatSidebar";
import { useStore } from "../store";

import { fireEvent } from "@testing-library/react";

// Mock the store
vi.mock("../store", () => ({
  useStore: vi.fn(),
}));

// Mock the api
vi.mock("../lib/api", () => ({
  getChats: vi.fn().mockResolvedValue([]),
  getChat: vi.fn().mockResolvedValue({ messages: [] }),
}));

// Mock ThinkingBlock so we can easily test if it received props
vi.mock("./ThinkingBlock", () => ({
  default: ({ steps, isStreaming }: any) => (
    <div data-testid="mock-thinking-block" data-steps={steps.length} data-streaming={isStreaming}>
      Mock Thinking Block
    </div>
  ),
}));

// Mock ReactMarkdown since it's hard to render in simple tests
vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="mock-markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({
  default: () => {},
}));

describe("ChatSidebar Tool Steps Interleaving", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    (useStore as any).mockReturnValue({
      activeFiles: [],
      currentThreadId: null,
      setThreadId: vi.fn(),
      chatHistory: [],
      setChatHistory: vi.fn(),
      setEditorContent: vi.fn(),
      setQueryResult: vi.fn(),
      setLastError: vi.fn(),
      setAgentLastQuery: vi.fn(),
      bumpHistoryVersion: vi.fn(),
    });
    
    // Mock the fetch call for settings
    global.fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ model_chat: "mock", agent_profile: "mock" })
    });
  });

  it("should render thinking block correctly within an assistant message", async () => {
    // For this test, we need to manipulate the internal state of ChatSidebar.
    // The easiest way is to mock fetch, trigger handleSend, and push an event.
    
    // Setup fetch mock to return a stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Enqueue a tool_call start event
        controller.enqueue(encoder.encode('data: {"type":"tool_call","tool":"get_schema","status":"start"}\n\n'));
        
        // Enqueue a token event
        controller.enqueue(encoder.encode('data: {"type":"token","content":"I am thinking."}\n\n'));
        
        controller.close();
      }
    });
    
    global.fetch = vi.fn().mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({ model_chat: "mock", agent_profile: "mock" })
    }).mockResolvedValueOnce({
      ok: true,
      body: stream
    });

    render(<ChatSidebar width={300} />);
    
    // Simulate typing and sending
    const input = screen.getByPlaceholderText("ask...");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Wait for stream to process
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const tb = screen.getByTestId("mock-thinking-block");
    expect(tb).toBeInTheDocument();
    expect(tb.getAttribute("data-steps")).toBe("1");
    
    const md = screen.getByTestId("mock-markdown");
    expect(md.textContent).toBe("I am thinking.");
  });
});
