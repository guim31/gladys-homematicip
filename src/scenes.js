// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// The set point, the mode and the boost of a room, a switch, a cover are
// already Gladys scene actions on the device features. These add what a
// feature cannot say:
//   - start_absence: the eco mode of the whole home, for a number of hours
//     (or until ended) — "everybody left";
//   - start_vacation: the vacation mode, with its temperature and its days;
//   - end_absence: back to the normal programme, whichever of the two runs;
//   - set_alarm_mode: arm (or disarm) the alarm system, within what the
//     configuration allows (nothing by default), and tell the scene which
//     sensors kept it from arming.
//
// The trigger (`alarm_triggered`) is fired by the hub, never as a consequence
// of these actions: a scene bound to it would loop.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async start_absence(hub, { fields }) {
    const hours = Number(fields.duration ?? 0);
    await hub.startAbsence(Number.isFinite(hours) && hours > 0 ? hours * 60 : 0);
  },

  async start_vacation(hub, { fields }) {
    await hub.startVacation(fields.days ?? 7, fields.temperature ?? 15);
  },

  async end_absence(hub) {
    await hub.endAbsence();
  },

  async set_alarm_mode(hub, { fields }) {
    const { problems } = await hub.setAlarmMode(String(fields.mode));
    return { applied: problems.length === 0, blocking_sensors: problems.join(', ') };
  },
};
