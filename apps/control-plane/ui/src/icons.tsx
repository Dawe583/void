const paths: Record<string, string> = {
  menu: "M4 6h16M4 12h12M4 18h16",
  close: "m6 6 12 12M6 18 18 6",
  compose: "M12 5H5v14h14v-7M14 4l6 6M10 14l2-5 6-6 3 3-6 6-5 2Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  theme: "M12 3a9 9 0 1 0 9 9 9 9 0 0 1-9-9Z",
  motion: "m13 3-8 11h6l-1 7 9-12h-6l1-6Z",
  context: "M3 4h18v16H3ZM15 4v16",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  language:
    "M3 5h12M9 3v2M6 5c0 5 3 8 8 10M12 5c0 5-3 8-8 10m9 6 4-10 4 10m-6-4h4",
  chat: "M4 4h16v13H9l-5 4V4Z",
  overview: "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
  sessions: "M5 5h14M5 12h14M5 19h14",
  runs: "M3 12h4l3-8 4 16 3-8h4",
  documents: "M5 3h9l5 5v13H5ZM14 3v6h5M8 13h8M8 17h6",
  approvals: "m5 12 4 4L19 6",
  ledger: "M5 3h14v18H5ZM8 7h8M8 12h8M8 17h5",
  connections:
    "m9 15 6-6M7 14l-2 2a3 3 0 0 0 4 4l3-3M12 7l3-3a3 3 0 0 1 4 4l-2 2",
  models: "m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
  undo: "M8 4 3 9l5 5M3 9h10a6 6 0 0 1 0 12",
  send: "M12 20V4m-7 7 7-7 7 7",
};
export function Icon({ name }: { name: string }) {
  return (
    <svg
      className="ui-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 3 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name] ?? paths.chat} />
    </svg>
  );
}
