import React, { useEffect, useRef, useState } from 'react';
import NotesIcon from "../src/Notes_Ico.svg";
import EtiquetasIcon from "../src/Etiquetas_Ico.svg";
import NotasButtonIcon from "../src/Notas_button.svg";

interface StickyTag {
  id: string;
  label: string;
  color: string;
  isDefault?: boolean;
}

interface StickyNoteBlock {
  id: string;
  text: string;
  type: 'paragraph' | 'check';
  checked: boolean;
}

interface StickyNoteItem {
  id: string;
  title: string;
  content: string;
  blocks: StickyNoteBlock[];
  tagIds: string[];
  accent: string;
  createdAt: string;
  updatedAt: string;
}

interface StickyNotesBoardState {
  tags: StickyTag[];
  notes: StickyNoteItem[];
}

interface GeneralNotesOverlayProps {
  visible: boolean;
  onClose: () => void;
}

const GENERAL_NOTES_STORAGE_KEY = 'armi_general_notes_board_v1';
const DEFAULT_NOTE_ACCENTS = [
  'from-amber-100 via-orange-50 to-white',
  'from-sky-100 via-blue-50 to-white',
  'from-fuchsia-100 via-violet-50 to-white',
  'from-emerald-100 via-teal-50 to-white',
];

const DEFAULT_NOTE_TAGS: StickyTag[] = [
  { id: 'general', label: 'General', color: 'bg-slate-100 text-slate-700 border-slate-200', isDefault: true },
  { id: 'urgente', label: 'Urgente', color: 'bg-rose-100 text-rose-700 border-rose-200', isDefault: true },
  { id: 'seguimiento', label: 'Seguimiento', color: 'bg-sky-100 text-sky-700 border-sky-200', isDefault: true },
  { id: 'drive', label: 'Drive', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', isDefault: true },
];

const toBlocksFromLegacyContent = (content: string): StickyNoteBlock[] =>
  String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `legacy-${index}-${line.slice(0, 10) || 'block'}`,
      text: line,
      type: 'paragraph' as const,
      checked: false,
    }));

const serializeBlocksToContent = (blocks: StickyNoteBlock[]) =>
  blocks
    .map((block) => String(block.text || '').trim())
    .filter(Boolean)
    .join('\n');

const normalizeNote = (note: Partial<StickyNoteItem>, index: number): StickyNoteItem => {
  const blocks: StickyNoteBlock[] = Array.isArray(note.blocks) && note.blocks.length
    ? note.blocks.map((block, blockIndex) => ({
        id: String(block?.id || `block-${index}-${blockIndex}`),
        text: String(block?.text || ''),
        type: (block?.type === 'check' ? 'check' : 'paragraph') as StickyNoteBlock['type'],
        checked: block?.type === 'check' ? Boolean(block?.checked) : false,
      }))
    : toBlocksFromLegacyContent(String(note.content || ''));

  return {
    id: String(note.id || `note-${index}`),
    title: String(note.title || 'Nueva nota'),
    content: serializeBlocksToContent(blocks),
    blocks,
    tagIds: Array.isArray(note.tagIds) ? note.tagIds.map((item) => String(item)) : [],
    accent: String(note.accent || DEFAULT_NOTE_ACCENTS[index % DEFAULT_NOTE_ACCENTS.length]),
    createdAt: String(note.createdAt || new Date().toISOString()),
    updatedAt: String(note.updatedAt || new Date().toISOString()),
  };
};

const DEFAULT_NOTES_BOARD_STATE: StickyNotesBoardState = {
  tags: DEFAULT_NOTE_TAGS,
  notes: [
    normalizeNote({
      id: 'note-welcome',
      title: 'Tablero de notas',
      content: 'Usa este espacio para recordatorios, acuerdos y pendientes que tambien deban viajar en la sincronizacion local.',
    }, 0),
  ],
};

const readStickyNotesBoardState = (): StickyNotesBoardState => {
  try {
    const raw = window.localStorage.getItem(GENERAL_NOTES_STORAGE_KEY);
    if (!raw) return DEFAULT_NOTES_BOARD_STATE;
    const parsed = JSON.parse(raw) as Partial<StickyNotesBoardState>;
    return {
      tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags : DEFAULT_NOTE_TAGS,
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.map((note, index) => normalizeNote(note, index))
        : DEFAULT_NOTES_BOARD_STATE.notes,
    };
  } catch {
    return DEFAULT_NOTES_BOARD_STATE;
  }
};

const mergeDefaultTags = (tags: StickyTag[]) => {
  const merged = [...DEFAULT_NOTE_TAGS];
  tags.forEach((tag) => {
    if (!merged.some((existing) => existing.id === tag.id)) {
      merged.push(tag);
    }
  });
  return merged;
};

export const GeneralNotesOverlay: React.FC<GeneralNotesOverlayProps> = ({ visible, onClose }) => {
  const [notesFilter, setNotesFilter] = useState<string>('all');
  const [newTagLabel, setNewTagLabel] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [activeBlockByNote, setActiveBlockByNote] = useState<Record<string, string>>({});
  const blockTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const [board, setBoard] = useState<StickyNotesBoardState>(() => {
    const initial = readStickyNotesBoardState();
    return {
      tags: mergeDefaultTags(initial.tags),
      notes: initial.notes,
    };
  });

  useEffect(() => {
    window.localStorage.setItem(GENERAL_NOTES_STORAGE_KEY, JSON.stringify({
      tags: board.tags,
      notes: board.notes,
    }));
  }, [board]);

  if (!visible) return null;

  const filteredNotes = notesFilter === 'all'
    ? board.notes
    : board.notes.filter((note) => note.tagIds.includes(notesFilter));

  const updateNote = (noteId: string, patch: Partial<StickyNoteItem>) => {
    setBoard((prev) => ({
      ...prev,
      notes: prev.notes.map((note) => note.id === noteId
        ? { ...note, ...patch, updatedAt: new Date().toISOString() }
        : note),
    }));
  };

  const updateNoteBlocks = (noteId: string, blocks: StickyNoteBlock[]) => {
    updateNote(noteId, {
      blocks,
      content: serializeBlocksToContent(blocks),
    });
  };

  const createNote = () => {
    const primaryTagId = notesFilter !== 'all' ? notesFilter : (board.tags[0]?.id || 'general');
    const now = new Date().toISOString();
    const firstBlock: StickyNoteBlock = {
      id: `block-${Date.now()}-root`,
      text: '',
      type: 'paragraph',
      checked: false,
    };
    const nextNote: StickyNoteItem = {
      id: `note-${Date.now()}`,
      title: 'Nueva nota',
      content: '',
      blocks: [firstBlock],
      tagIds: primaryTagId ? [primaryTagId] : [],
      accent: DEFAULT_NOTE_ACCENTS[board.notes.length % DEFAULT_NOTE_ACCENTS.length],
      createdAt: now,
      updatedAt: now,
    };
    setBoard((prev) => ({ ...prev, notes: [nextNote, ...prev.notes] }));
    setActiveBlockByNote((prev) => ({ ...prev, [nextNote.id]: firstBlock.id }));
    focusBlock(firstBlock.id);
  };

  const toggleNoteTag = (noteId: string, tagId: string) => {
    const current = board.notes.find((note) => note.id === noteId);
    if (!current) return;
    const tagIds = current.tagIds.includes(tagId)
      ? current.tagIds.filter((id) => id !== tagId)
      : [...current.tagIds, tagId];
    updateNote(noteId, { tagIds });
  };

  const deleteNote = (noteId: string) => {
    setBoard((prev) => ({
      ...prev,
      notes: prev.notes.filter((note) => note.id !== noteId),
    }));
  };

  const addTag = () => {
    const normalized = newTagLabel.trim();
    if (!normalized) return;
    const slug = normalized
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    if (!slug) return;
    if (board.tags.some((tag) => tag.id === slug || tag.label.toLowerCase() === normalized.toLowerCase())) {
      setNewTagLabel('');
      return;
    }
    const palette = [
      'bg-amber-100 text-amber-700 border-amber-200',
      'bg-sky-100 text-sky-700 border-sky-200',
      'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
      'bg-emerald-100 text-emerald-700 border-emerald-200',
      'bg-violet-100 text-violet-700 border-violet-200',
    ];
    setBoard((prev) => ({
      ...prev,
      tags: [...prev.tags, { id: slug, label: normalized, color: palette[prev.tags.length % palette.length] }],
    }));
    setNewTagLabel('');
  };

  const removeTag = (tagId: string) => {
    const target = board.tags.find((tag) => tag.id === tagId);
    if (!target) return;
    setBoard((prev) => ({
      tags: prev.tags.filter((tag) => tag.id !== tagId),
      notes: prev.notes.map((note) => ({
        ...note,
        tagIds: note.tagIds.filter((id) => id !== tagId),
      })),
    }));
    if (notesFilter === tagId) setNotesFilter('all');
  };

  const autoResizeBlockTextarea = (element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${Math.max(element.scrollHeight, 24)}px`;
  };

  const focusBlock = (blockId: string) => {
    window.setTimeout(() => {
      const target = blockTextareaRefs.current[blockId];
      if (!target) return;
      target.focus();
      const length = target.value.length;
      target.setSelectionRange(length, length);
    }, 0);
  };

  const convertOrCreateBlockInNote = (noteId: string, type: StickyNoteBlock['type']) => {
    const note = board.notes.find((item) => item.id === noteId);
    if (!note) return;

    const candidateBlockId = activeBlockByNote[noteId] || note.blocks[note.blocks.length - 1]?.id || '';
    const hasCandidate = candidateBlockId && note.blocks.some((block) => block.id === candidateBlockId);

    if (hasCandidate) {
      const nextBlocks = note.blocks.map((block) => (
        block.id === candidateBlockId
          ? {
              ...block,
              type,
              checked: type === 'check' ? block.checked : false,
            }
          : block
      ));
      updateNoteBlocks(noteId, nextBlocks);
      focusBlock(candidateBlockId);
      return;
    }

    const newBlock = {
      id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: '',
      type,
      checked: false,
    };
    const nextBlocks = [...note.blocks, newBlock];
    updateNoteBlocks(noteId, nextBlocks);
    setActiveBlockByNote((prev) => ({ ...prev, [noteId]: newBlock.id }));
    focusBlock(newBlock.id);
  };

  const updateBlockText = (noteId: string, blockId: string, text: string) => {
    const note = board.notes.find((item) => item.id === noteId);
    if (!note) return;
    updateNoteBlocks(noteId, note.blocks.map((block) => (
      block.id === blockId ? { ...block, text } : block
    )));
  };

  const insertBlockAfter = (noteId: string, blockId: string, type: StickyNoteBlock['type']) => {
    const note = board.notes.find((item) => item.id === noteId);
    if (!note) return;
    const currentIndex = note.blocks.findIndex((block) => block.id === blockId);
    const nextBlock: StickyNoteBlock = {
      id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: '',
      type,
      checked: false,
    };
    const nextBlocks = [...note.blocks];
    const insertIndex = currentIndex >= 0 ? currentIndex + 1 : nextBlocks.length;
    nextBlocks.splice(insertIndex, 0, nextBlock);
    updateNoteBlocks(noteId, nextBlocks);
    setActiveBlockByNote((prev) => ({ ...prev, [noteId]: nextBlock.id }));
    focusBlock(nextBlock.id);
  };

  const toggleBlockChecked = (noteId: string, blockId: string) => {
    const note = board.notes.find((item) => item.id === noteId);
    if (!note) return;
    updateNoteBlocks(noteId, note.blocks.map((block) => (
      block.id === blockId && block.type === 'check'
        ? { ...block, checked: !block.checked }
        : block
    )));
  };

  const removeBlockFromNote = (noteId: string, blockId: string) => {
    const note = board.notes.find((item) => item.id === noteId);
    if (!note) return;
    const currentIndex = note.blocks.findIndex((block) => block.id === blockId);
    const previousBlockId = currentIndex > 0 ? note.blocks[currentIndex - 1]?.id || '' : '';
    const nextBlocks = note.blocks.filter((block) => block.id !== blockId);
    updateNoteBlocks(noteId, nextBlocks);
    setActiveBlockByNote((prev) => ({
      ...prev,
      [noteId]: previousBlockId || nextBlocks[0]?.id || '',
    }));
    if (previousBlockId) focusBlock(previousBlockId);
  };

  return (
    <div className="fixed inset-0 z-[320] bg-slate-950/45 backdrop-blur-sm p-4 md:p-8">
      <div className="mx-auto flex h-full max-w-[1500px] flex-col overflow-hidden rounded-[2.4rem] border border-white/60 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] shadow-[0_25px_80px_rgba(15,23,42,0.28)]">
        <div className="border-b border-slate-200/80 px-6 py-4 md:px-8">
          <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-start">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">
                Notas sincronizables
              </div>

              <h2 className="mt-2 text-xl font-black tracking-tight text-slate-800">
                Tablero de notas editables
              </h2>

              <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-slate-500">
                Crea recordatorios, clasificalos por etiquetas y decide si cada linea sera un parrafo normal o una tarea con check.
              </p>
            </div>

            <div className="flex w-full flex-col items-end gap-3 xl:w-[800px]">
              <div className="flex w-full items-start justify-end gap-3">
                <div className="relative min-h-[58px] flex-1 rounded-[1.2rem] border border-slate-200/80 bg-white/75 px-3 pb-3 pt-5 shadow-sm">
                  <div className="absolute left-4 top-1.5 text-[8px] font-black uppercase tracking-[0.22em] text-slate-400">
                    Etiquetas
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowTagInput((prev) => !prev)}
                    className={`absolute -right-2 -top-2 z-30 flex h-7 w-7 items-center justify-center rounded-full border shadow-sm transition ${
                      showTagInput
                        ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'
                        : 'border-green-200 bg-green-600 text-white hover:bg-green-700'
                    }`}
                    title={showTagInput ? 'Cancelar etiqueta' : 'Nueva etiqueta'}
                    aria-label={showTagInput ? 'Cancelar etiqueta' : 'Nueva etiqueta'}
                  >
                    {showTagInput ? (
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    ) : (
                      <img
                        src={EtiquetasIcon}
                        alt="Nueva etiqueta"
                        className="h-4 w-4 brightness-0 invert"
                        draggable={false}
                      />
                    )}
                  </button>

                  {showTagInput ? (
                    <div className="absolute right-8 top-2 z-20 flex items-center gap-1 rounded-full border border-dashed border-blue-300 bg-blue-50/95 px-2 py-1 shadow-lg shadow-slate-900/10 backdrop-blur">
                      <input
                        type="text"
                        value={newTagLabel}
                        autoFocus
                        onChange={(e) => setNewTagLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag();
                            setShowTagInput(false);
                          }

                          if (e.key === 'Escape') {
                            setNewTagLabel('');
                            setShowTagInput(false);
                          }
                        }}
                        placeholder="Nueva etiqueta..."
                        className="h-5 w-[130px] bg-transparent px-1 text-[8px] font-black uppercase tracking-[0.1em] text-blue-800 outline-none placeholder:text-blue-400"
                      />

                      <button
                        type="button"
                        onClick={() => {
                          addTag();
                          setShowTagInput(false);
                        }}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700"
                        title="Crear etiqueta"
                        aria-label="Crear etiqueta"
                      >
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="m20 6-11 11-5-5" />
                        </svg>
                      </button>
                    </div>
                  ) : null}

                  <div className="flex max-h-[74px] min-h-[22px] w-full flex-wrap items-center justify-end gap-1.5 overflow-y-auto pr-4">
                    <button
                      type="button"
                      onClick={() => setNotesFilter('all')}
                      className={`inline-flex h-5 items-center gap-1 rounded-full border px-2.5 text-[8px] font-black uppercase tracking-[0.14em] transition ${
                        notesFilter === 'all'
                          ? 'border-slate-900 bg-slate-900 text-white shadow-md shadow-slate-900/15'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      Todas
                      <span className="rounded-full bg-black/10 px-1 py-[1px] text-[7px] leading-none">
                        {board.notes.length}
                      </span>
                    </button>

                    {board.tags.map((tag) => {
                      const count = board.notes.filter((note) => note.tagIds.includes(tag.id)).length;
                      const active = notesFilter === tag.id;

                      return (
                        <div
                          key={tag.id}
                          className={`group relative inline-flex h-5 items-center rounded-full border transition ${
                            active
                              ? `${tag.color} shadow-sm ring-1 ring-slate-900/10`
                              : `${tag.color} opacity-85 hover:opacity-100 hover:shadow-sm`
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setNotesFilter(tag.id)}
                            className="inline-flex h-full items-center gap-1 rounded-full px-2.5 pr-4 text-[8px] font-black uppercase tracking-[0.11em]"
                          >
                            <span>{tag.label}</span>

                            <span className="rounded-full bg-white/65 px-1 py-[1px] text-[7px] leading-none">
                              {count}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => removeTag(tag.id)}
                            className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full border border-white bg-rose-500 text-[9px] leading-none text-white shadow-sm transition group-hover:flex hover:bg-rose-600"
                            title={`Eliminar etiqueta ${tag.label}`}
                            aria-label={`Eliminar etiqueta ${tag.label}`}
                          >
                            x
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={createNote}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-blue-200 bg-blue-600 text-white shadow-lg shadow-blue-600/20 transition hover:scale-[1.02] hover:bg-blue-700"
                    title="Nueva nota"
                    aria-label="Nueva nota"
                  >
                    <img
                      src={NotesIcon}
                      alt="Nueva nota"
                      className="h-6 w-6 brightness-0 invert"
                    />
                  </button>

                  <button
                    type="button"
                    onClick={onClose}
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-100"
                    title="Cerrar"
                    aria-label="Cerrar"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_32%,#f8fafc_100%)]">
          <section className="flex h-full flex-col overflow-y-auto p-6 md:p-8">
            {filteredNotes.length === 0 ? (
              <div className="flex h-full min-h-[360px] items-center justify-center rounded-[2.4rem] border border-dashed border-slate-300 bg-white/80 p-10 text-center shadow-inner">
                <div>
                  <div className="text-4xl">Notas</div>
                  <div className="mt-4 text-lg font-black text-slate-700">No hay notas para esta etiqueta</div>
                  <p className="mt-2 max-w-md text-sm font-medium text-slate-500">Puedes crear una nueva nota o cambiar el filtro para volver a ver todas.</p>
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[1180px] columns-1 gap-5 md:columns-2 xl:columns-3" style={{ columnGap: '1rem' }}>
                {filteredNotes.map((note, index) => {
                  const rotation = index % 2 === 0 ? '-2.6deg' : '2.4deg';
                  const pinColor = index % 3 === 0 ? 'bg-orange-400' : index % 3 === 1 ? 'bg-blue-500' : 'bg-violet-500';

                  return (
                    <article
                      key={note.id}
                      className="group relative mb-5 break-inside-avoid rounded-[1.55rem] border border-white/80 bg-white p-2.5 shadow-[0_16px_38px_rgba(15,23,42,0.08)] transition hover:-translate-y-1 hover:shadow-[0_22px_55px_rgba(15,23,42,0.14)]"
                      style={{ transform: `rotate(${rotation})` }}
                    >
                      <div className={`absolute left-1/2 top-2.5 z-10 h-4 w-4 -translate-x-1/2 rounded-full shadow-[0_0_0_4px_rgba(255,255,255,0.35),0_8px_20px_rgba(15,23,42,0.25)] ${pinColor}`}></div>
                      <div className="relative rounded-[1.8rem] bg-white p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                        <div className={`absolute inset-2 rounded-[1.45rem] bg-gradient-to-br ${note.accent} opacity-85`}></div>
                        <div className="relative z-10 flex flex-col">
                          <div className="flex items-start justify-between gap-2 pt-5">
                            <span className="font-serif text-[36px] italic leading-none tracking-[0.01em] text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                            <div className="flex items-center gap-1.5 opacity-0 transition group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => convertOrCreateBlockInNote(note.id, 'paragraph')}
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white/70 text-slate-400 transition hover:text-blue-600"
                                title="Convertir a parrafo"
                                aria-label="Convertir a parrafo"
                              >
                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M5 7h10" />
                                  <path d="M5 12h14" />
                                  <path d="M5 17h9" />
                                  <path d="M19 8v8" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => convertOrCreateBlockInNote(note.id, 'check')}
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white/70 text-slate-400 transition hover:text-emerald-600"
                                title="Convertir a check"
                                aria-label="Convertir a check"
                              >
                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <rect x="4" y="5" width="6" height="6" rx="1.5" />
                                  <path d="m5.5 8 1.3 1.3L9 7" />
                                  <path d="M13 8h7" />
                                  <rect x="4" y="13" width="6" height="6" rx="1.5" />
                                  <path d="M13 16h7" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteNote(note.id)}
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/80 bg-white/70 text-slate-400 transition hover:text-rose-500"
                                title="Eliminar nota"
                                aria-label="Eliminar nota"
                              >
                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          <input
                            type="text"
                            value={note.title}
                            onChange={(e) => updateNote(note.id, { title: e.target.value })}
                            placeholder="Titulo de la nota"
                            className="relative mt-1.5 rounded-2xl border border-transparent bg-transparent px-2 py-1 text-[1.05rem] font-bold leading-[1] tracking-tight text-slate-900 outline-none transition focus:border-white/80 focus:bg-white/45"
                          />

                          <div className="relative mt-2 space-y-1.5 rounded-[1.35rem] border border-transparent bg-transparent px-2 py-1.5 transition focus-within:border-white/80 focus-within:bg-white/40">
                            {note.blocks.length ? note.blocks.map((block) => (
                              <div key={block.id} className="group/block flex items-start gap-2">
                                {block.type === 'check' ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleBlockChecked(note.id, block.id)}
                                    className={`mt-[2px] flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition ${
                                      block.checked
                                        ? 'border-emerald-500 bg-emerald-500 text-white'
                                        : 'border-slate-300 bg-white/80 text-transparent hover:border-emerald-400'
                                    }`}
                                    title={block.checked ? 'Desmarcar check' : 'Marcar check'}
                                    aria-label={block.checked ? 'Desmarcar check' : 'Marcar check'}
                                  >
                                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <path d="m5 13 4 4L19 7" />
                                    </svg>
                                  </button>
                                ) : (
                                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                                )}

                                <textarea
                                  ref={(element) => {
                                    blockTextareaRefs.current[block.id] = element;
                                  }}
                                  value={block.text}
                                  onFocus={() => {
                                    setActiveBlockByNote((prev) => ({ ...prev, [note.id]: block.id }));
                                  }}
                                  onChange={(e) => {
                                    updateBlockText(note.id, block.id, e.target.value);
                                    autoResizeBlockTextarea(e.currentTarget);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      insertBlockAfter(note.id, block.id, block.type);
                                      return;
                                    }
                                    if (e.key === 'Backspace' && !block.text.trim() && note.blocks.length > 1) {
                                      e.preventDefault();
                                      removeBlockFromNote(note.id, block.id);
                                    }
                                  }}
                                  onInput={(e) => autoResizeBlockTextarea(e.currentTarget)}
                                  placeholder={block.type === 'check' ? 'Escribe una tarea...' : 'Escribe un parrafo...'}
                                  rows={1}
                                  className={`min-h-[24px] flex-1 resize-none overflow-hidden bg-transparent text-[12px] font-medium leading-[1.45] outline-none ${
                                    block.type === 'check' && block.checked
                                      ? 'text-slate-400 line-through'
                                      : 'text-slate-700'
                                  }`}
                                />

                                <button
                                  type="button"
                                  onClick={() => removeBlockFromNote(note.id, block.id)}
                                  className="mt-[1px] hidden h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/70 hover:text-rose-500 group-hover/block:flex"
                                  title="Eliminar linea"
                                  aria-label="Eliminar linea"
                                >
                                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                  </svg>
                                </button>
                              </div>
                            )) : (
                              <div className="py-2 text-[12px] font-medium text-slate-400">
                                Usa los dos botones pequenos para agregar un parrafo o un check a esta nota.
                              </div>
                            )}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {board.tags.map((tag) => {
                              const active = note.tagIds.includes(tag.id);
                              return (
                                <button
                                  key={tag.id}
                                  type="button"
                                  onClick={() => toggleNoteTag(note.id, tag.id)}
                                  className={`rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.14em] transition ${active ? tag.color : 'border-white/80 bg-white/70 text-slate-500 hover:bg-white'}`}
                                >
                                  {tag.label}
                                </button>
                              );
                            })}
                          </div>

                          <div className="mt-3 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">
                            Editado {new Date(note.updatedAt).toLocaleString('es-PE')}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export const GeneralNotesFloatingButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="fixed bottom-5 right-[4.25rem] z-40 flex h-9 w-9 items-center justify-center rounded-full border border-violet-200 bg-white/95 text-violet-700 shadow-[0_16px_40px_rgba(15,23,42,0.16)] backdrop-blur transition hover:-translate-y-0.5 hover:bg-violet-50 hover:border-violet-300 print:hidden"
    title="Abrir notas"
    aria-label="Abrir notas"
  >
    <img
      src={NotasButtonIcon}
      alt=""
      aria-hidden="true"
      className="h-5 w-5 object-contain"
      draggable={false}
    />
  </button>
);
