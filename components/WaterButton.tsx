type WaterButtonProps = {
  loading?: boolean;
  success?: boolean;
  onClick: () => void;
  text?: string;
};

export default function WaterButton({
  loading = false,
  success = false,
  onClick,
  text = "Guardar"
}: WaterButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`
        relative overflow-hidden px-6 py-2 rounded-lg
        font-black uppercase text-[11px]
        transition-all duration-300
        bg-indigo-600 text-white
        hover:bg-indigo-700
        active:scale-95
        ${loading ? "cursor-wait" : ""}
      `}
    >
      {success && <span className="success-burst" />}

      <span className={`transition-opacity ${success ? "opacity-0" : "opacity-100"}`}>
        {loading ? "Guardando..." : text}
      </span>

      {success && (
        <span className="absolute inset-0 flex items-center justify-center check-anim">
          ✓
        </span>
      )}
    </button>
  );
}
