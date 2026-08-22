let nextFeedbackId = 0;
const subscribers = new Set();
const bufferedEvents = [];

function publish(event) {
  if (!subscribers.size) {
    bufferedEvents.push(event);
    return;
  }
  subscribers.forEach((subscriber) => subscriber(event));
}

export function subscribeToFeedback(subscriber) {
  subscribers.add(subscriber);
  if (bufferedEvents.length) {
    bufferedEvents.splice(0).forEach((event) => subscriber(event));
  }
  return () => subscribers.delete(subscriber);
}

export function showToast(
  message,
  { title, tone = "neutral", duration = 3200 } = {}
) {
  const toast = {
    id: ++nextFeedbackId,
    message,
    title,
    tone,
    duration: Math.max(1000, duration),
  };
  publish({ type: "toast", toast });
  return toast.id;
}

export function showDialog(options) {
  return new Promise((resolve) => {
    publish({
      type: "dialog",
      dialog: {
        id: ++nextFeedbackId,
        options,
        resolve,
      },
    });
  });
}
