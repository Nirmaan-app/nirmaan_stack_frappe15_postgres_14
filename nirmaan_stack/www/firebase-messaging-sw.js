importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.0/firebase-messaging.js');

const firebaseConfig = {
    apiKey: "AIzaSyAZWGDU4LU-EIHJ0P14sNEKXTw91mB5_2Y",
    authDomain: "nirmaan-stack.firebaseapp.com",
    projectId: "nirmaan-stack",
    storageBucket: "nirmaan-stack.appspot.com",
    messagingSenderId: "260249096269",
    appId: "1:260249096269:web:b5e2c804c3dd39616d4c04",
    measurementId: "G-L623HFQCFY"
  };

firebase.initializeApp(firebaseConfig);
firebase.messaging().usePublicVapidKey("BKCnCTRykNel6hGvgixZVcBs7Hyzzox6H9qZdmWV6golyHlLd3EIV9hTdyJd0AKlC0r7ZMd1Wplgpc9K190oiIQ");

const messaging = firebase.messaging();

self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients.claim().then(() => {
      self.registration.update({ scope: 'https://test.nirmaan.app/frontend' }); 
    })
  );
});

// Background message handler
messaging.onBackgroundMessage((payload) => {
  console.log('Received background message: ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '../src/assets/red-logo.png',
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});