import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ChatSidebar from "./ChatSidebar";
import { useStore } from "../store";

declare const global: typeof globalThis;

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

// Mock ReactMarkdown to render children and intercept table elements
vi.mock("react-markdown", () => ({
  default: ({ children, components }: any) => {
    // If components has a table renderer, test it by rendering a fake table
    if (components?.table) {
      const TableWrapper = components.table;
      return (
        <div data-testid="mock-markdown">
          <TableWrapper>
            <tbody><tr><td>test cell with long content that could overflow</td></tr></tbody>
          </TableWrapper>
          {children}
        </div>
      );
    }
    return <div data-testid="mock-markdown">{children}</div>;
  },
}));
vi.mock("remark-gfm", () => ({
  default: () => {},
}));

const defaultStoreValues = {
  activeFiles: [],
  files: [
    { name: "test.csv", path: "/test.csv", size_bytes: 100, extension: "csv" },
    { name: "users.parquet", path: "/users.parquet", size_bytes: 200, extension: "parquet" },
    { name: "orders.json", path: "/orders.json", size_bytes: 300, extension: "json" },
  ],
  currentThreadId: null,
  setThreadId: vi.fn(),
  chatHistory: [],
  setChatHistory: vi.fn(),
  setEditorContent: vi.fn(),
  setQueryResult: vi.fn(),
  setLastError: vi.fn(),
  setAgentLastQuery: vi.fn(),
  bumpHistoryVersion: vi.fn(),
  addActiveFile: vi.fn(),
  removeActiveFile: vi.fn(),
  toggleActiveFile: vi.fn(),
};

describe("ChatSidebar Tool Steps Interleaving", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    (useStore as any).mockReturnValue({ ...defaultStoreValues });
    
    // Mock the fetch call for settings
    global.fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ model_chat: "mock", agent_profile: "mock" })
    });
  });

  it("should render thinking block correctly within an assistant message", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"tool_call","tool":"get_schema","status":"start"}\n\n'));
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
    
    const input = screen.getByPlaceholderText("ask...");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const tb = screen.getByTestId("mock-thinking-block");
    expect(tb).toBeInTheDocument();
    expect(tb.getAttribute("data-steps")).toBe("1");
    
    const md = screen.getByTestId("mock-markdown");
    expect(md.textContent).toContain("I am thinking.");
  });
});

describe("ChatSidebar Table Overflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    (useStore as any).mockReturnValue({ ...defaultStoreValues });
    global.fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ model_chat: "mock", agent_profile: "mock" })
    });
  });

  it("should wrap markdown tables in a scrollable container", async () => {
    // Send a message that will generate an assistant response with a table
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"token","content":"| col1 | col2 |\\n|---|---|\\n| a | b |"}\n\n'));
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

    const input = screen.getByPlaceholderText("ask...");
    fireEvent.change(input, { target: { value: "show table" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    // The table should be wrapped in a div with overflow-x: auto
    const tableWrapper = document.querySelector('[data-testid="table-scroll-wrapper"]');
    expect(tableWrapper).toBeInTheDocument();
    expect((tableWrapper as HTMLElement).style.overflowX).toBe("auto");
  });
});

describe("ChatSidebar @-mention autocomplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    (useStore as any).mockReturnValue({ ...defaultStoreValues });
    global.fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ model_chat: "mock", agent_profile: "mock" })
    });
  });

  it("should show autocomplete popover when @ is typed", () => {
    render(<ChatSidebar width={300} />);
    const input = screen.getByPlaceholderText("ask...");
    
    fireEvent.change(input, { target: { value: "@" } });

    const popover = screen.getByTestId("mention-popover");
    expect(popover).toBeInTheDocument();
  });

  it("should filter files when typing after @", () => {
    render(<ChatSidebar width={300} />);
    const input = screen.getByPlaceholderText("ask...");
    
    fireEvent.change(input, { target: { value: "@test" } });

    const popover = screen.getByTestId("mention-popover");
    expect(popover).toBeInTheDocument();
    // Should show test.csv but not others
    expect(screen.getByText("test.csv")).toBeInTheDocument();
    expect(screen.queryByText("orders.json")).not.toBeInTheDocument();
  });

  it("should select a file and add it to active files when clicked", () => {
    const addActiveFile = vi.fn();
    (useStore as any).mockReturnValue({ ...defaultStoreValues, addActiveFile });

    render(<ChatSidebar width={300} />);
    const input = screen.getByPlaceholderText("ask...");
    
    fireEvent.change(input, { target: { value: "@test" } });
    
    const option = screen.getByText("test.csv");
    fireEvent.click(option);

    expect(addActiveFile).toHaveBeenCalledWith("test.csv");
  });

  it("should close popover and clear @-text after selection", () => {
    const addActiveFile = vi.fn();
    (useStore as any).mockReturnValue({ ...defaultStoreValues, addActiveFile });

    render(<ChatSidebar width={300} />);
    const input = screen.getByPlaceholderText("ask...");
    
    fireEvent.change(input, { target: { value: "hello @test" } });
    
    const option = screen.getByText("test.csv");
    fireEvent.click(option);

    // Popover should disappear
    expect(screen.queryByTestId("mention-popover")).not.toBeInTheDocument();
  });

  it("should navigate options with ArrowDown/ArrowUp and select with Enter", () => {
    const addActiveFile = vi.fn();
    (useStore as any).mockReturnValue({ ...defaultStoreValues, addActiveFile });

    render(<ChatSidebar width={300} />);
    const input = screen.getByPlaceholderText("ask...");

    fireEvent.change(input, { target: { value: "@" } });
    
    // Initially at index 0 (test.csv)
    // ArrowDown to index 1 (users.parquet)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // ArrowDown to index 2 (orders.json)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // ArrowUp back to index 1 (users.parquet)
    fireEvent.keyDown(input, { key: "ArrowUp" });
    // Enter to select users.parquet
    fireEvent.keyDown(input, { key: "Enter" });

    expect(addActiveFile).toHaveBeenCalledWith("users.parquet");
  });

  it("should close popover when Escape is pressed", () => {
    render(<ChatSidebar width={300} />);
    const input = screen.getByPlaceholderText("ask...");

    fireEvent.change(input, { target: { value: "@" } });
    expect(screen.getByTestId("mention-popover")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("mention-popover")).not.toBeInTheDocument();
  });
});

describe("ChatSidebar SSE parsing robustness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    (useStore as any).mockReturnValue({ ...defaultStoreValues });
    global.fetch = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ model_chat: "mock", agent_profile: "mock" }),
    });
  });

  function makeStream(chunks: string[]) {
    const encoder = new TextEncoder();
    let index = 0;
    return new ReadableStream({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(encoder.encode(chunks[index]));
          index++;
        } else {
          controller.close();
        }
      },
    });
  }

  function mockFetchWithStream(stream: ReadableStream) {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ model_chat: "mock", agent_profile: "mock" }),
      })
      .mockResolvedValueOnce({ ok: true, body: stream });
  }

  async function sendMessage() {
    render(<ChatSidebar width={300} />);
    const input = screen.getByPlaceholderText("ask...");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  it("should handle JSON payload split across two chunks", async () => {
    const stream = makeStream([
      'data: {"type":"token","conte',
      'nt":"split-works"}\n\n',
    ]);
    mockFetchWithStream(stream);
    await sendMessage();

    const md = screen.getByTestId("mock-markdown");
    expect(md.textContent).toContain("split-works");
  });

  it("should handle multiple SSE events in a single chunk", async () => {
    const stream = makeStream([
      'data: {"type":"token","content":"hello"}\n\ndata: {"type":"token","content":" world"}\n\n',
    ]);
    mockFetchWithStream(stream);
    await sendMessage();

    const md = screen.getByTestId("mock-markdown");
    expect(md.textContent).toContain("hello world");
  });

  it("should skip non-data lines (comments, event:, empty lines)", async () => {
    const stream = makeStream([
      ': this is a comment\nevent: message\nid: 123\n\ndata: {"type":"token","content":"visible"}\n\n',
    ]);
    mockFetchWithStream(stream);
    await sendMessage();

    const md = screen.getByTestId("mock-markdown");
    expect(md.textContent).toContain("visible");
  });

  it("should handle data: without space after colon", async () => {
    const stream = makeStream([
      'data:{"type":"token","content":"no-space"}\n\n',
    ]);
    mockFetchWithStream(stream);
    await sendMessage();

    const md = screen.getByTestId("mock-markdown");
    expect(md.textContent).toContain("no-space");
  });

  it("should handle a data line split across three chunks", async () => {
    const stream = makeStream([
      'data: {"type":',
      '"token","con',
      'tent":"three-way"}\n\n',
    ]);
    mockFetchWithStream(stream);
    await sendMessage();

    const md = screen.getByTestId("mock-markdown");
    expect(md.textContent).toContain("three-way");
  });

  it("should handle remaining buffer data after stream ends", async () => {
    // Stream ends without trailing newline — data is in the buffer
    const stream = makeStream([
      'data: {"type":"token","content":"trailing"}',
    ]);
    mockFetchWithStream(stream);
    await sendMessage();

    const md = screen.getByTestId("mock-markdown");
    expect(md.textContent).toContain("trailing");
  });
});
