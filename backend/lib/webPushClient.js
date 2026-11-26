// web-push 4 is ESM while the backend and its Jest tests are CommonJS.
exports.sendNotification = async (...args) => {
    const { sendNotification } = await import('web-push');
    return sendNotification(...args);
};
