(() => {
  const geolocation = navigator.geolocation;
  if (!geolocation || window.__deckplatingFreshLocationShim) return;

  const nativeGetCurrentPosition = geolocation.getCurrentPosition.bind(geolocation);
  const nativeWatchPosition = geolocation.watchPosition.bind(geolocation);
  const nativeClearWatch = geolocation.clearWatch.bind(geolocation);
  const targetAccuracyMeters = 35;
  const acquisitionTimeoutMs = 15000;

  const locationError = (code, message) => ({
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  });

  geolocation.getCurrentPosition = (success, error, options = {}) => {
    if (!options.enableHighAccuracy) {
      nativeGetCurrentPosition(success, error, options);
      return;
    }

    let bestPosition = null;
    let completed = false;
    let watchId = null;
    let timerId = null;

    const stop = () => {
      if (watchId !== null) nativeClearWatch(watchId);
      if (timerId !== null) window.clearTimeout(timerId);
      watchId = null;
      timerId = null;
    };

    const finish = () => {
      if (completed) return;
      completed = true;
      stop();
      if (bestPosition) {
        success(bestPosition);
      } else if (error) {
        error(locationError(3, 'Fresh location acquisition timed out.'));
      }
    };

    const onPosition = (position) => {
      const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : Number.POSITIVE_INFINITY;
      const bestAccuracy = bestPosition && Number.isFinite(bestPosition.coords.accuracy)
        ? bestPosition.coords.accuracy
        : Number.POSITIVE_INFINITY;
      if (!bestPosition || accuracy < bestAccuracy) bestPosition = position;
      if (accuracy <= targetAccuracyMeters) finish();
    };

    const onError = (positionError) => {
      if (bestPosition) {
        finish();
      } else if (!completed) {
        completed = true;
        stop();
        if (error) error(positionError);
      }
    };

    watchId = nativeWatchPosition(onPosition, onError, {
      ...options,
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: acquisitionTimeoutMs,
    });
    timerId = window.setTimeout(finish, acquisitionTimeoutMs);
  };

  window.__deckplatingFreshLocationShim = true;
})();
