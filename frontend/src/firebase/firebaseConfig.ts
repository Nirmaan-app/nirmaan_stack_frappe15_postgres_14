import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import {getMessaging, getToken} from "firebase/messaging"

const firebaseConfig = {
  apiKey: "AIzaSyAZWGDU4LU-EIHJ0P14sNEKXTw91mB5_2Y",
  authDomain: "nirmaan-stack.firebaseapp.com",
  projectId: "nirmaan-stack",
  storageBucket: "nirmaan-stack.appspot.com",
  messagingSenderId: "260249096269",
  appId: "1:260249096269:web:b5e2c804c3dd39616d4c04",
  measurementId: "G-L623HFQCFY"
};


const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const messaging = getMessaging(app)
export const VAPIDKEY = "BKCnCTRykNel6hGvgixZVcBs7Hyzzox6H9qZdmWV6golyHlLd3EIV9hTdyJd0AKlC0r7ZMd1Wplgpc9K190oiIQ"
// getToken(messaging, { vapidKey: VAPIDKEY })
//   .then((currentToken) => {
//     if (currentToken) {
//       console.log("FCM Token:", currentToken);
//       // Send this token to your server to store for sending notifications
//     } else {
//       console.log("No registration token available. Request permission to generate one.");
//     }
//   })
//   .catch((err) => {
//     console.log("An error occurred while retrieving token. ", err);
//   });