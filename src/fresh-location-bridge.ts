const targetAccuracyMeters = 35;

const locationError = (code: number, message: string) =>
  ({
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  }) as GeolocationPositionError;

export function acquireFreshPosition(
  success: PositionCallback,
  error: PositionErrorCallback,
  options: PositionOptions = {},
) {
  let bestPosition: GeolocationPosition | null = null;
  let completed = false;
  let watchId: number | null = null;
  let timerId: number | null = null;
  const requestedTimeout = Number.isFinite(options.timeout) ? Number(options.timeout) : 10000;
  const timeoutMs = Math.max(1000, requestedTimeout);

  const stop = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (timerId !== null) window.clearTimeout(timerId);
    watchId = null;
    timerId = null;
  };

  const finish = () => {
    if (completed) return;
    completed = true;
    stop();
    if (bestPosition) success(bestPosition);
    else error(locationError(3, 'Fresh location acquisition timed out.'));
  };

  const onPosition: PositionCallback = (position) => {
    if (completed) return;
    const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : Number.POSITIVE_INFINITY;
    const bestAccuracy = bestPosition && Number.isFinite(bestPosition.coords.accuracy)
      ? bestPosition.coords.accuracy
      : Number.POSITIVE_INFINITY;
    if (!bestPosition || accuracy < bestAccuracy) bestPosition = position;
    if (accuracy <= targetAccuracyMeters) finish();
  };

  const onError: PositionErrorCallback = (positionError) => {
    if (completed) return;
    if (bestPosition) finish();
    else {
      completed = true;
      stop();
      error(positionError);
    }
  };

  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    ...options,
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: timeoutMs,
  });
  if (completed) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  } else {
    timerId = window.setTimeout(finish, timeoutMs);
  }

  return () => {
    completed = true;
    stop();
  };
}
