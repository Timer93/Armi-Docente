export type OrderedCriterion = {
    id: string;
    compId: string;
    cap: string;
    [key: string]: any;
};

const groupKey = (item: OrderedCriterion) => `${item.compId}\u0000${item.cap}`;

/**
 * Converts the AI's suggestions into contiguous curricular blocks. Every
 * capacity is covered before the sequence ends and every session receives at
 * least one criterion. Repetitions stay together instead of cycling backwards.
 */
export const distributeOrderedCriteriaByBlocks = (
    sessionCount: number,
    catalog: OrderedCriterion[],
    suggestedIndexes: number[][] = []
): OrderedCriterion[][] => {
    const totalSessions = Math.max(0, Math.trunc(sessionCount));
    const distributed = Array.from({ length: totalSessions }, () => [] as OrderedCriterion[]);
    if (totalSessions === 0 || catalog.length === 0) return distributed;

    const groups: OrderedCriterion[][] = [];
    const groupIndexByKey = new Map<string, number>();
    catalog.forEach((criterion) => {
        const key = groupKey(criterion);
        let index = groupIndexByKey.get(key);
        if (index === undefined) {
            index = groups.length;
            groupIndexByKey.set(key, index);
            groups.push([]);
        }
        groups[index].push(criterion);
    });

    const suggestedGroupCounts = Array(groups.length).fill(0);
    const suggestedItemsByGroup: OrderedCriterion[][][] = Array.from({ length: groups.length }, () => []);
    suggestedIndexes.slice(0, totalSessions).forEach((indexes) => {
        const validIndexes = (Array.isArray(indexes) ? indexes : [])
            .map((value) => Number(value) - 1)
            .filter((index) => Number.isInteger(index) && index >= 0 && index < catalog.length);
        const firstValid = validIndexes[0];
        if (firstValid === undefined) return;
        const groupIndex = groupIndexByKey.get(groupKey(catalog[firstValid]));
        if (groupIndex === undefined) return;
        suggestedGroupCounts[groupIndex] += 1;
        const selectedForGroup = validIndexes
            .map((index) => catalog[index])
            .filter((item, index, items) => groupKey(item) === groupKey(catalog[firstValid])
                && items.findIndex((candidate) => candidate.id === item.id) === index);
        suggestedItemsByGroup[groupIndex].push(selectedForGroup);
    });

    if (totalSessions >= groups.length) {
        const slots = suggestedGroupCounts.map((count) => Math.max(1, count));
        while (slots.reduce((sum, count) => sum + count, 0) > totalSessions) {
            const reducible = slots
                .map((count, index) => ({ count, index, desired: suggestedGroupCounts[index] }))
                .filter(({ count }) => count > 1)
                .sort((left, right) => (right.count - right.desired) - (left.count - left.desired) || right.count - left.count)[0];
            if (!reducible) break;
            slots[reducible.index] -= 1;
        }
        while (slots.reduce((sum, count) => sum + count, 0) < totalSessions) {
            const target = slots
                .map((count, index) => ({ count, index, deficit: suggestedGroupCounts[index] - count }))
                .sort((left, right) => right.deficit - left.deficit || left.count - right.count || left.index - right.index)[0];
            slots[target.index] += 1;
        }

        let sessionIndex = 0;
        groups.forEach((criteria, groupIndex) => {
            const blockSize = slots[groupIndex];
            const block = Array.from({ length: blockSize }, (_, offset) => [
                ...(suggestedItemsByGroup[groupIndex][offset] || [])
            ]);
            criteria.forEach((criterion, criterionIndex) => {
                if (block.some((items) => items.some((item) => item.id === criterion.id))) return;
                const target = Math.min(
                    blockSize - 1,
                    Math.floor((criterionIndex * blockSize) / criteria.length)
                );
                block[target].push(criterion);
            });
            for (let offset = 0; offset < blockSize; offset += 1) {
                distributed[sessionIndex] = block[offset].length > 0
                    ? block[offset]
                    : [criteria[Math.min(
                        criteria.length - 1,
                        Math.floor((offset * criteria.length) / blockSize)
                    )]];
                sessionIndex += 1;
            }
        });
        return distributed;
    }

    // Rare case: fewer sessions than capacities. Keep their order and place
    // adjacent capacity groups together so none disappears.
    for (let sessionIndex = 0; sessionIndex < totalSessions; sessionIndex += 1) {
        const start = Math.floor((sessionIndex * groups.length) / totalSessions);
        const end = Math.floor(((sessionIndex + 1) * groups.length) / totalSessions);
        distributed[sessionIndex] = groups.slice(start, Math.max(start + 1, end)).flat();
    }
    return distributed;
};
