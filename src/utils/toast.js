import Toastify from "toastify-js";

function toast(message, { duration = 1000 } = {}) {
  Toastify({
    text: message,
    duration,
    close: true,
  }).showToast();
}

export default toast;
