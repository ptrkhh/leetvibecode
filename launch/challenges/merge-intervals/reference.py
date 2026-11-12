def merge_intervals(intervals, gap=0):
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1] + gap:
            if end > merged[-1][1]:
                merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged
