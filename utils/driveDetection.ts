type DriveObservation = {
  detected?: boolean;
  installed?: boolean;
  processRunning?: boolean | null;
};

export const getDriveDetectionState = (drive?: DriveObservation | null): 'detected' | 'not-detected' | 'unknown' => {
  if (drive?.detected || drive?.installed || drive?.processRunning === true) return 'detected';
  if (drive?.detected === false && drive?.processRunning === false) return 'not-detected';
  return 'unknown';
};
