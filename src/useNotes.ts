import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { makeNote, type Note } from "../shared/notes";

const JOURNAL = "keep.pending.v1";
type Pending = {
  desired: Note;
  generation: number;
  flight?: { note: Note; mutationId: string; generation: number };
  blocked?: boolean;
};
function readJournal(): Record<string, Pending> {
  try {
    return JSON.parse(sessionStorage.getItem(JOURNAL) ?? "{}");
  } catch {
    return {};
  }
}
export function useNotes(
  onExpired: (message: string) => void,
  onRecovered: (from: string, to: string) => void,
) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [ready, setReady] = useState(false);
  const [noteWidth, setNoteWidth] = useState(300);
  const [status, setStatus] = useState("Loading");
  const [message, setMessage] = useState("");
  const pending = useRef(readJournal());
  const active = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const alive = useRef(true);
  const epoch = useRef(0);
  const editGeneration = useRef(0);
  const expiry = useRef(onExpired);
  const recovery = useRef(onRecovered);
  expiry.current = onExpired;
  recovery.current = onRecovered;
  const updateOne = (note: Note) =>
    setNotes((all) =>
      all.some((n) => n.id === note.id)
        ? all.map((n) => (n.id === note.id ? note : n))
        : [note, ...all],
    );
  const journal = () => {
    try {
      if (Object.keys(pending.current).length)
        sessionStorage.setItem(JOURNAL, JSON.stringify(pending.current));
      else sessionStorage.removeItem(JOURNAL);
    } catch {
      setMessage(
        "This browser cannot retain drafts through a refresh. Keep this tab open until saved.",
      );
    }
  };
  const pumpRef = useRef<(id: string) => Promise<void>>(async () => {});
  const schedule = (id: string, delay: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      setTimeout(() => {
        void pumpRef.current(id);
      }, delay),
    );
  };
  pumpRef.current = async (id: string) => {
    const entry = pending.current[id];
    if (!alive.current || active.current.has(id) || !entry || entry.blocked)
      return;
    active.current.add(id);
    const startedEpoch = epoch.current;
    const flight = entry.flight ?? {
      note: structuredClone(entry.desired),
      mutationId: crypto.randomUUID(),
      generation: entry.generation,
    };
    entry.flight = flight;
    journal();
    setStatus("Saving");
    try {
      const { note } = await api<{ note: Note }>(`/notes/${id}`, "PUT", {
        note: flight.note,
        mutationId: flight.mutationId,
      });
      if (!alive.current || startedEpoch !== epoch.current) return;
      editGeneration.current++;
      const latest = pending.current[id];
      if (latest.generation === flight.generation) {
        delete pending.current[id];
        updateOne(note);
      } else {
        latest.desired = {
          ...latest.desired,
          version: note.version,
          createdAt: note.createdAt,
          deletedAt:
            latest.desired.status === "trashed" ? note.deletedAt : null,
        };
        latest.flight = undefined;
        updateOne(latest.desired);
        schedule(id, 50);
      }
      journal();
      setStatus(Object.keys(pending.current).length ? "Saving" : "All saved");
    } catch (error) {
      if (!alive.current || startedEpoch !== epoch.current) return;
      if (error instanceof ApiError && [409, 410].includes(error.status)) {
        const current = error.data.current as Note | undefined;
        const copy: Note = {
          ...pending.current[id].desired,
          id: crypto.randomUUID(),
          version: 0,
          title:
            `${pending.current[id].desired.title || "Untitled"} (recovered)`.slice(
              0,
              300,
            ),
          status: "active",
          deletedAt: null,
        };
        delete pending.current[id];
        pending.current[copy.id] = { desired: copy, generation: 1 };
        setNotes((all) => [
          copy,
          ...all.filter((n) => n.id !== id),
          ...(current ? [current] : []),
        ]);
        journal();
        schedule(copy.id, 50);
        editGeneration.current++;
        recovery.current(id, copy.id);
        setMessage(
          "This note changed elsewhere. Your edits are preserved in a recovered copy.",
        );
      } else if (error instanceof ApiError && error.status === 401) {
        setStatus("Sign in to sync");
        expiry.current(error.message);
      } else if (
        error instanceof ApiError &&
        [400, 413].includes(error.status)
      ) {
        pending.current[id].blocked = true;
        setStatus("Needs attention");
        setMessage(error.message);
        journal();
      } else {
        setStatus("Waiting to sync");
        schedule(id, 5000);
      }
    } finally {
      if (startedEpoch === epoch.current) active.current.delete(id);
    }
  };
  const refresh = useCallback(async () => {
    const startedEpoch = epoch.current;
    const startedGeneration = editGeneration.current;
    try {
      const data = await api<{ notes: Note[]; noteWidth: number }>("/notes");
      if (
        !alive.current ||
        startedEpoch !== epoch.current ||
        startedGeneration !== editGeneration.current
      )
        return;
      setNotes([
        ...data.notes.filter((n) => !pending.current[n.id]),
        ...Object.values(pending.current).map((e) => e.desired),
      ]);
      setNoteWidth(data.noteWidth);
      setReady(true);
      if (!Object.keys(pending.current).length) setStatus("All saved");
      Object.keys(pending.current).forEach((id) => schedule(id, 100));
    } catch (error) {
      if (!alive.current || startedEpoch !== epoch.current) return;
      if (error instanceof ApiError && error.status === 401)
        expiry.current(error.message);
      setStatus("Waiting to sync");
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    epoch.current++;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20000);
    const focus = () => {
      void refresh();
    };
    const before = (event: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("online", focus);
    window.addEventListener("focus", focus);
    window.addEventListener("beforeunload", before);
    return () => {
      alive.current = false;
      epoch.current++;
      active.current.clear();
      clearInterval(timer);
      timers.current.forEach(clearTimeout);
      window.removeEventListener("online", focus);
      window.removeEventListener("focus", focus);
      window.removeEventListener("beforeunload", before);
    };
  }, [refresh]);
  function change(note: Note) {
    editGeneration.current++;
    const previous = pending.current[note.id];
    pending.current[note.id] = {
      desired: { ...note, updatedAt: Date.now() },
      generation: (previous?.generation ?? 0) + 1,
      flight: previous?.blocked ? undefined : previous?.flight,
    };
    updateOne(pending.current[note.id].desired);
    journal();
    setStatus("Saving");
    schedule(note.id, 500);
  }
  function create() {
    const note = makeNote();
    change(note);
    return note.id;
  }
  async function flush() {
    const start = Date.now();
    while (Object.keys(pending.current).length && Date.now() - start < 17000) {
      await Promise.all(
        Object.keys(pending.current).map((id) => pumpRef.current(id)),
      );
      if (Object.keys(pending.current).length)
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return Object.keys(pending.current).length === 0;
  }
  async function changeWidth(value: number) {
    try {
      await api("/settings", "PUT", { noteWidth: value });
      setNoteWidth(value);
    } catch {
      setMessage("Could not save the note width. Please try again.");
    }
  }
  return {
    notes,
    ready,
    status,
    message,
    setMessage,
    noteWidth,
    changeWidth,
    change,
    create,
    flush,
    refresh,
  };
}
