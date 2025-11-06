// // hooks/usePermissionCheck.ts
// import { useState, useCallback } from "react";

// export const usePermissionCheck = () => {
//   const [cameraStatus, setCameraStatus] = useState<PermissionState | "unsupported">("prompt");
//   const [locationStatus, setLocationStatus] = useState<PermissionState | "unsupported">("prompt");

//   const checkCamera = useCallback(async () => {
//     try {
//       if (!navigator.mediaDevices?.getUserMedia) {
//         setCameraStatus("unsupported");
//         return "Camera is not supported on this device.";
//       }

//       const status = await navigator.permissions
//         .query({ name: "camera" as PermissionName })
//         .catch(() => null);

//       if (status) setCameraStatus(status.state);

//       if (status?.state === "denied") {
//         return "Camera is blocked. Enable it in device settings.";
//       }

//       // this triggers popup
//       const stream = await navigator.mediaDevices.getUserMedia({ video: true });
//       stream.getTracks().forEach(t => t.stop());

//       setCameraStatus("granted");
//       return "Camera permission granted ✅";

//     } catch (err: any) {
//       setCameraStatus("denied");
//       return "Camera permission denied. Enable in device settings.";
//     }
//   }, []);

//   const checkLocation = useCallback(async () => {
//     if (!navigator.geolocation) {
//       setLocationStatus("unsupported");
//       return "Location is not supported.";
//     }

//     try {
//       const status = await navigator.permissions
//         .query({ name: "geolocation" })
//         .catch(() => null);

//       if (status) setLocationStatus(status.state);

//       if (status?.state === "denied") {
//         return "Location blocked. Enable it in phone settings.";
//       }

//       await new Promise((resolve, reject) =>
//         navigator.geolocation.getCurrentPosition(resolve, reject, {
//           enableHighAccuracy: true,
//         })
//       );

//       setLocationStatus("granted");
//       return "Location permission granted ✅";

//     } catch (err: any) {
//       setLocationStatus("denied");
//       return "Location permission denied. Enable in settings.";
//     }
//   }, []);

//   return { cameraStatus, locationStatus, checkCamera, checkLocation };
// };


// usePermissionCheck.ts
import { useState, useEffect } from "react";

export function usePermissionCheck() {
  const [cameraStatus, setCameraStatus] = useState<PermissionState | "unsupported">("prompt");
  const [locationStatus, setLocationStatus] = useState<PermissionState | "unsupported">("prompt");

  // ✅ CAMERA
  const checkCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });

      stream.getTracks().forEach(t => t.stop());

      setCameraStatus("granted");
      return "Camera permission granted ✅.";
    } catch (err) {
      setCameraStatus("denied");
      return "Camera permission denied ❌.";
    }
  };

  // ✅ LOCATION
  const checkLocation = async () => {
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        () => {
          setLocationStatus("granted");
          resolve("Location permission granted ✅.");
        },
        () => {
          setLocationStatus("denied");
          resolve("Location permission denied ❌.");
        }
      );
    });
  };

  // ✅ AUTO-SUBSCRIBE to Permission API (if supported)
  useEffect(() => {
    if (navigator.permissions) {
      navigator.permissions.query({ name: "camera" as PermissionName }).then(p => {
        setCameraStatus(p.state);
        p.onchange = () => setCameraStatus(p.state);
      });

      navigator.permissions.query({ name: "geolocation" }).then(p => {
        setLocationStatus(p.state);
        p.onchange = () => setLocationStatus(p.state);
      });
    }
  }, []);

  return { cameraStatus, locationStatus, checkCamera, checkLocation };
}
