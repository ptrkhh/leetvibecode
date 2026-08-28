type ActiveModel = { id: string; openrouterId: string };
type Round0Run = { modelId: string; errorKind: string | null };

export function eligibleModelIds(
  roster: string[],
  activeModels: ActiveModel[],
  round0Runs: Round0Run[] | null,
): string[] {
  let ids = activeModels.filter((m) => roster.includes(m.openrouterId)).map((m) => m.id);
  if (round0Runs) {
    const survived = new Set(
      round0Runs.filter((r) => r.errorKind !== "platform").map((r) => r.modelId),
    );
    ids = ids.filter((id) => survived.has(id));
  }
  return ids;
}
