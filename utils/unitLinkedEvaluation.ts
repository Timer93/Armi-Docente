/** Update the matrix source, never a session-only copy that save/reload can overwrite. */
export const editUnitLinkedEvaluation = (
    unit: any,
    sessionId: number,
    kind: 'criteria' | 'evidence',
    sourceId: string,
    value: string,
    splitEvidence: (value: string) => string[]
) => {
    const session = (unit.sesiones || []).find((candidate: any) => candidate.id === sessionId);
    if (!session) return unit;
    if (kind === 'criteria') {
        const option = (session.availableCriteriaOptions || []).find((candidate: any) => candidate.id === sourceId);
        if (!option || !Number.isInteger(option.matrixIdx)) return unit;
        const field = option.isTrans ? 'criteriosTrans' : 'criterios';
        return { ...unit, [field]: { ...unit[field], [option.matrixIdx]: value } };
    }
    const option = (session.availableEvidenceOptions || []).find((candidate: any) => candidate.id === sourceId);
    const match = sourceId.match(/^(area|trans)-(\d+)-(\d+)$/);
    if (!option || !match || Number(match[2]) !== option.matrixIdx) return unit;
    const field = option.isTrans ? 'evidenciasTrans' : 'evidencias';
    const entries = splitEvidence(unit[field]?.[option.matrixIdx] || '');
    const position = Number(match[3]);
    if (position >= entries.length) return unit;
    // Display bullets belong to the list, not to the evidence content.
    entries[position] = value.replace(/^\s*[•·*-]\s*/, '');
    let sesiones = unit.sesiones;
    if (!entries[position].trim()) {
        entries.splice(position, 1);
        const remap = (id: string) => {
            const reference = id?.match(/^(area|trans)-(\d+)-(\d+)$/);
            if (!reference || reference[1] !== match[1] || reference[2] !== match[2]) return id;
            const index = Number(reference[3]);
            return index === position ? null : `${reference[1]}-${reference[2]}-${index > position ? index - 1 : index}`;
        };
        sesiones = unit.sesiones.map((candidate: any) => {
            const prefix = `${match[1]}-${match[2]}-`;
            if (!(candidate.selectedEvidenceIds || []).some((id: string) => id.startsWith(prefix))
                && !(candidate.evidenceItems || []).some((item: any) => item.sourceEvidenceId?.startsWith(prefix))) return candidate;
            const evidenceItems = (candidate.evidenceItems || []).flatMap((item: any) => {
                if (!item.sourceEvidenceId) return [item];
                const sourceEvidenceId = remap(item.sourceEvidenceId);
                return sourceEvidenceId ? [{ ...item, sourceEvidenceId }] : [];
            });
            return { ...candidate, evidenceItems, evi: evidenceItems.map((item: any) => item.text).join('\n').trim(),
                selectedEvidenceIds: (candidate.selectedEvidenceIds || []).map(remap).filter(Boolean) };
        });
    }
    const text = entries.length === 1 ? entries[0] : entries.map((entry) => `• ${entry}`).join('\n');
    return { ...unit, sesiones, [field]: { ...unit[field], [option.matrixIdx]: text } };
};
