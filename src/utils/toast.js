import Toastify from "toastify-js";

function toast(message, { duration = 1000 } = {}) {
  Toastify({
    text: message,
    duration,
  }).showToast();
}

export default toast;
