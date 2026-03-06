const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

if (!VAPID_PUBLIC_KEY) {
    console.warn('VITE_VAPID_PUBLIC_KEY is not set. Push notifications will be disabled.');
}

export async function subscribeToPush(username) {
    if (!VAPID_PUBLIC_KEY) return null;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return null;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();

    if (!subscription) {
        subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
    }

    // Send to backend
    const API_BASE = (
        import.meta.env.VITE_API_BASE_URL ||
        import.meta.env.VITE_SOCKET_URL ||
        ''
    ).replace(/\/$/, '');

    const res = await fetch(`${API_BASE}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, subscription: subscription.toJSON() }),
    });

    if (!res.ok) {
        console.error('Push subscribe failed:', res.status);
        try { await subscription.unsubscribe(); } catch { /* ignore */ }
        return null;
    }

    return subscription;
}

export async function unsubscribeFromPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
        const API_BASE = (
            import.meta.env.VITE_API_BASE_URL ||
            import.meta.env.VITE_SOCKET_URL ||
            ''
        ).replace(/\/$/, '');

        await fetch(`${API_BASE}/api/push/unsubscribe`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}
