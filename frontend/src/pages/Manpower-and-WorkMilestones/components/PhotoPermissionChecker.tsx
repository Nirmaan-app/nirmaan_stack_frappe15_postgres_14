// import React, { useState, useCallback } from "react";
// import { Button } from "@/components/ui/button";
// import { Camera, MapPin, X, CheckCircle } from "lucide-react"; // Added CheckCircle, X
// import { CalendarIcon, PlusCircledIcon } from "@radix-ui/react-icons";
// import { TailSpin } from "react-loader-spinner";
// import { toast } from "@/components/ui/use-toast";

// interface PhotoPermissionCheckerProps {
//   isBlockedByDraftOwnership: boolean;
//   onAddPhotosClick: () => void;
//   GEO_API: string | undefined;
// }

// const PhotoPermissionChecker: React.FC<PhotoPermissionCheckerProps> = ({
//   isBlockedByDraftOwnership,
//   onAddPhotosClick,
//   GEO_API,
// }) => {
//   // Use null as initial state to represent 'not checked yet'
//   const [isCameraEnabled, setIsCameraEnabled] = useState<boolean | null>(null);
//   const [isLocationEnabled, setIsLocationEnabled] = useState<boolean | null>(null);
//   const [isCheckingPermissions, setIsCheckingPermissions] = useState(false);

//   // --- HANDLER: Check Camera Permission ---
//   const handleCheckCamera = useCallback(async () => {
//     if (isBlockedByDraftOwnership || isCheckingPermissions) return;
    
//     setIsCameraEnabled(null); // Reset status to 'checking' visually
//     setIsCheckingPermissions(true);

//     try {
//         // This is the call that prompts the browser for camera permission
//         const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        
//         // Stop all tracks immediately to release the camera
//         stream.getTracks().forEach(track => track.stop());

//         setIsCameraEnabled(true);
//         toast({
//             title: "Camera Ready! 📸",
//             description: "Camera access confirmed. Permissions granted.",
//             variant: "default",
//         });
//     } catch (error: any) {
//         console.error("Camera access test failed:", error);
        
//         let description = "Could not access camera. Please check device and browser settings.";
//         if (error.name === 'NotAllowedError') {
//             description = "Camera permission denied. Please click the button again or manually grant permission in browser settings.";
//         } else if (error.name === 'NotFoundError') {
//             description = "No camera found on this device.";
//         }
        
//         setIsCameraEnabled(false);
//         toast({
//             title: "Camera Blocked 🚫",
//             description: description,
//             variant: "destructive",
//         });
//     } finally {
//         setIsCheckingPermissions(false);
//     }
//   }, [isBlockedByDraftOwnership, isCheckingPermissions]);

//   // --- HANDLER: Check Location Permission ---
//   const handleCheckLocation = useCallback(async () => {
//     if (isBlockedByDraftOwnership || isCheckingPermissions) return;
    
//     setIsLocationEnabled(null); // Reset status to 'checking' visually
//     setIsCheckingPermissions(true);

//     if (!navigator.geolocation) {
//         setIsLocationEnabled(false);
//         setIsCheckingPermissions(false);
//         toast({ 
//             title: "Geolocation Error 🗺️", 
//             description: "Geolocation is not supported by your browser.", 
//             variant: "destructive" 
//         });
//         return;
//     }

//     try {
//         const position: GeolocationPosition = await new Promise((resolve, reject) => {
//             // This is the call that prompts the browser for location permission
//             navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
//         });

//         const lat = position.coords.latitude;
//         const lon = position.coords.longitude;
//         let locationMessage = `Location found at Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}.`;

//         if (GEO_API) {
//             // Optional: Try reverse geocoding to get a city name
//             const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&key=${GEO_API}`);
//             const data = await response.json();
//             const formattedAddress = data?.results[0]?.formatted_address;
//             if (formattedAddress) {
//                 locationMessage = `Location found: ${formattedAddress}.`;
//             }
//         }

//         setIsLocationEnabled(true);
//         toast({
//             title: "Location Ready! ✅",
//             description: locationMessage,
//             variant: "default",
//         });
//     } catch (error: any) {
//         console.error("Location access test failed:", error);
//         let description = "Could not fetch location. Check device location services and browser permissions.";
//         if (error.code === error.PERMISSION_DENIED) {
//             description = "Location permission denied. Please click the button again or manually grant permission in browser settings.";
//         } else if (error.code === error.TIMEOUT) {
//             description = "Location check timed out. Try again in a spot with better signal.";
//         }
        
//         setIsLocationEnabled(false);
//         toast({
//             title: "Location Blocked 🗺️",
//             description: description,
//             variant: "destructive",
//         });
//     } finally {
//         setIsCheckingPermissions(false);
//     }
//   }, [isBlockedByDraftOwnership, isCheckingPermissions, GEO_API]);


//   const isAddPhotosEnabled = isCameraEnabled === true && isLocationEnabled === true;

//   const getButtonClassNames = (isEnabled: boolean | null) => {
//     if (isEnabled === true) {
//         return 'bg-green-100 text-green-700 border-green-400 hover:bg-green-200';
//     }
//     if (isEnabled === false) {
//         return 'bg-red-100 text-red-700 border-red-400 hover:bg-red-200';
//     }
//     // Default/Checking state (null)
//     return 'border-gray-400 text-gray-700 hover:bg-gray-100';
//   }

//   // --- STEP DISPLAY HELPERS ---
//   const CheckIcon = isCameraEnabled === true ? <CheckCircle className="h-4 w-4 text-green-600" /> : 
//                      isCameraEnabled === false ? <X className="h-4 w-4 text-red-600" /> : 
//                      <Camera className="h-4 w-4 text-gray-600" />;

//   const LocationIcon = isLocationEnabled === true ? <CheckCircle className="h-4 w-4 text-green-600" /> : 
//                        isLocationEnabled === false ? <X className="h-4 w-4 text-red-600" /> : 
//                        <MapPin className="h-4 w-4 text-gray-600" />;
//   // --- END STEP DISPLAY HELPERS ---

//   return (
//     <div className="flex flex-col items-center pb-4 pt-0 space-y-3">
//         {/* MODIFIED: Single-row grid-cols-3 for all three buttons in the first row */}
//         <div className="grid grid-cols-3 gap-2 w-full"> 
            
//             {/* BUTTON 1: Check Camera (Step 1) */}
//             <Button
//                 variant="outline"
//                 // Adjusted h-auto and py-2 for better vertical spacing
//                 className={`col-span-1 text-xs px-2 h-auto py-2 ${getButtonClassNames(isCameraEnabled)} flex-col justify-center`}
//                 onClick={handleCheckCamera}
//                 // Disable if blocked OR if any check is currently running
//                 disabled={isBlockedByDraftOwnership || isCheckingPermissions} 
//             >
//                 {isCheckingPermissions && isCameraEnabled === null ? <TailSpin height={16} width={16} color="#6B7280" /> : (
//                     <>
//                         <div className="flex items-center space-x-1 mb-1">
//                             {CheckIcon}
//                             <span className="font-semibold">Step 1</span>
//                         </div>
//                         <span className="text-[10px] truncate w-full text-center">Camera</span>
//                     </>
//                 )}
//             </Button>

//             {/* BUTTON 2: Check Location (Step 2) */}
//             <Button
//                 variant="outline"
//                 className={`col-span-1 text-xs px-2 h-auto py-2 ${getButtonClassNames(isLocationEnabled)} flex-col justify-center`}
//                 onClick={handleCheckLocation}
//                 // Disable if blocked OR if any check is currently running
//                 disabled={isBlockedByDraftOwnership || isCheckingPermissions} 
//             >
//                 {isCheckingPermissions && isLocationEnabled === null ? <TailSpin height={16} width={16} color="#6B7280" /> : (
//                     <>
//                         <div className="flex items-center space-x-1 mb-1">
//                             {LocationIcon}
//                             <span className="font-semibold">Step 2</span>
//                         </div>
//                         <span className="text-[10px] truncate w-full text-center">Location</span>
//                     </>
//                 )}
//             </Button>
            
//             {/* BUTTON 3: Add Photos (Step 3) - Primary Action */}
//             <Button
//                 // Use a standard height button for the primary action
//                 className={`col-span-1 text-xs px-2 h-auto py-2 bg-red-500 hover:bg-red-600 text-white flex-col justify-center ${!isAddPhotosEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
//                 onClick={onAddPhotosClick}
//                 disabled={isBlockedByDraftOwnership || !isAddPhotosEnabled || isCheckingPermissions} // Disabled if permissions aren't ready OR still checking
//             >
//                 <PlusCircledIcon className="h-4 w-4" />
//                 <span className="font-semibold mt-1">Step 3</span>
//                 <span className="text-[10px] truncate w-full text-center">Add Photos</span>
//             </Button>

//         </div>
//     </div>
//   );
// };

// export default PhotoPermissionChecker;


// import React from "react";
// import { Button } from "@/components/ui/button";
// import { Camera, MapPin, CheckCircle, X } from "lucide-react";
// import { toast } from "@/components/ui/use-toast";
// import { usePermissionCheck } from "../hooks/usePermissionCheck";

// interface PhotoPermissionCheckerProps {
//   onAddPhotosClick: () => void;
//   isBlockedByDraftOwnership: boolean;
// }

// const PhotoPermissionChecker: React.FC<PhotoPermissionCheckerProps> = ({
//   onAddPhotosClick,
//   isBlockedByDraftOwnership,
// }) => {
//   const {
//     cameraStatus,
//     locationStatus,
//     checkCamera,
//     checkLocation,
//   } = usePermissionCheck();

//   const isReady = cameraStatus === "granted" && locationStatus === "granted";

//   // ✅ Icon Renderer
//   const iconFor = (type: "camera" | "location") => {
//     const status = type === "camera" ? cameraStatus : locationStatus;

//     if (status === "granted")
//       return <CheckCircle className="w-4 h-4 text-green-600" />;
//     if (status === "denied")
//       return <X className="w-4 h-4 text-red-600" />;
//     return type === "camera"
//       ? <Camera className="w-4 h-4 text-gray-500" />
//       : <MapPin className="w-4 h-4 text-gray-500" />;
//   };

//   // ✅ Button border color based on status
//   const borderColor = (status: PermissionState | "unsupported") => {
//     if (status === "granted") return "border-green-400";
//     if (status === "denied") return "border-red-400";
//     return "border-gray-300";
//   };

//   console.log("Location Status:", locationStatus);


//   return (
//     <div className="flex flex-col space-y-3 w-full">

//       <div className="grid grid-cols-3 gap-2">

//         {/* STEP 1 CAMERA */}
//         <Button
//           variant="outline"
//           className={`flex flex-col items-center py-3 text-xs border ${borderColor(cameraStatus)}`}
//           onClick={async () => {
//             const msg = await checkCamera();
//             toast({ title: "Camera Check", description: msg });
//           }}
//           disabled={isBlockedByDraftOwnership}
//         >
//          {iconFor("camera")} 
//           <span className="mt-1">Step 1</span>
//           <span className="text-[10px]">Camera</span>
//         </Button>

//         {/* STEP 2 LOCATION */}
//         <Button
//           variant="outline"
//           className={`flex flex-col items-center py-3 text-xs border ${borderColor(locationStatus)}`}
//           onClick={async () => {
//             const msg = await checkLocation();
//             toast({ title: "Location Check", description: msg });
//           }}
//           disabled={isBlockedByDraftOwnership}
//         >
//           {iconFor("location")}
//           <iconFor type="location" />
//           <span className="mt-1">Step 2</span>
//           <span className="text-[10px]">Location</span>
//         </Button>

//         {/* STEP 3 ADD PHOTOS */}
//         <Button
//           className={`flex flex-col items-center py-3 bg-red-500 text-white text-xs ${
//             !isReady ? "opacity-50 cursor-not-allowed" : ""
//           }`}
//           disabled={!isReady}
//           onClick={onAddPhotosClick}
//         >
//           <CheckCircle className="h-4 w-4" />
//           <span className="mt-1">Step 3</span>
//           <span className="text-[10px]">Add Photos</span>
//         </Button>

//       </div>

//       {/* ✅ Show if permissions blocked */}
//       {(cameraStatus === "denied" || locationStatus === "denied") && (
//         <div className="text-red-500 text-xs bg-red-50 p-2 rounded-md">
//           Permissions are blocked.<br />
//           Please enable Camera & Location from:<br />
//           <strong>Settings → Apps → Browser → Permissions</strong>
//         </div>
//       )}

//     </div>
//   );
// };

// export default PhotoPermissionChecker;



import React from "react";
import { Button } from "@/components/ui/button";
import { Camera, MapPin, CheckCircle, X } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { usePermissionCheck } from "../hooks/usePermissionCheck";
import { CalendarIcon, PlusCircledIcon } from "@radix-ui/react-icons";

interface PhotoPermissionCheckerProps {
  onAddPhotosClick: () => void;
  isBlockedByDraftOwnership: boolean;
}

const PhotoPermissionChecker: React.FC<PhotoPermissionCheckerProps> = ({
  onAddPhotosClick,
  isBlockedByDraftOwnership,
}) => {
  const {
    cameraStatus,
    locationStatus,
    checkCamera,
    checkLocation,
  } = usePermissionCheck();

  const isReady = cameraStatus === "granted" && locationStatus === "granted";

  // ✅ Always return a valid icon (fallback for undefined / prompt)
 

  // ✅ Border color updates instantly & correctly
  const borderColor = (status: PermissionState | "unsupported" | undefined) => {
    const safeStatus = status || "prompt";

    if (safeStatus === "granted") return "border-green-500";
    if (safeStatus === "denied") return "border-red-500";
    return "border-gray-300";
  };

  return (
    <div className="flex flex-col space-y-3 w-full">

      <div className="grid grid-cols-3 gap-2">

        {/* ✅ STEP 1 CAMERA */}
        {/* <Button
          variant="outline"
          className={`flex flex-col p-2 items-center py-3 text-xs border ${borderColor(
            cameraStatus
          )}`}
          onClick={async () => {
            const msg = await checkCamera();
            toast({ title: "Camera Check", description: msg });
          }}
          disabled={isBlockedByDraftOwnership}
        >
         


        </Button> */}
                  <Button
  variant="outline"
  className={`relative flex flex-col items-center justify-center py-3 md:py-5 text-xs md:text-sm border ${borderColor(
    cameraStatus
  )}`}
  onClick={async () => {
    const msg = await checkCamera();
    toast({ title: "Camera Check", description: msg });
  }}
  disabled={isBlockedByDraftOwnership}
>

  {/* ✅ LEFT STATUS ICON */}
  <div className="absolute left-2 top-1/2 -translate-y-1/2">
   {cameraStatus === "granted" ? (<CheckCircle className="w-6 h-6 text-green-600" />):(<X className="w-6 h-6 text-red-600" />)}
  </div>

  {/* ✅ MAIN CENTERED CONTENT */}
  <div className="relative left-2">
<span className="font-semibold">Step 1</span>

  <span className="text-[10px] flex items-center gap-1">
    <Camera className="inline-block w-3 h-3 text-gray-500" />
    Camera
  </span>
  </div>
  
</Button>

        {/* ✅ STEP 2 LOCATION */}
        <Button
          variant="outline"
          className={`relative flex flex-col items-center justify-center py-3 md:py-5 text-xs md:text-sm border ${borderColor(
            locationStatus
          )}`}
          onClick={async () => {
            const msg = await checkLocation();
            toast({ title: "Location Check", description: msg });
          }}
          disabled={isBlockedByDraftOwnership}
        >
           <div className="absolute left-2 top-1/2 -translate-y-1/2">
   {locationStatus === "granted" ? (<CheckCircle className="w-6 h-6 text-green-600" />):(<X className="w-6 h-6 text-red-600" />)}
  </div>
  
          <div className="relative left-2">
          <span className="font-semibold">Step 2</span>
          <span className="text-[10px] flex items-center gap-1"><MapPin className="inline-block w-3 h-3 text-gray-500" />Location</span>
          </div>
        </Button>
        {/* ✅ STEP 3 ADD PHOTOS */}


        <Button
        variant="default"
          className={`relative flex flex-col items-center justify-center p-2 py-3 md:py-5 text-xs md:text-sm bg-red-500 text-white border border-red-500  ${
            !isReady ? "opacity-50 cursor-not-allowed" : ""
          }`}
          disabled={!isReady}
          onClick={onAddPhotosClick}
        >
          {/* <CheckCircle className="h-4 w-4" />
          <span className="mt-1 font-semibold">Step 3</span>
          <span className="text-[10px]">Add Photos</span>
          <div className="absolute left-2 top-1/2 -translate-y-1/2"> */}
   <div className="absolute left-2 top-1/2 -translate-y-1/2">
   <PlusCircledIcon className="h-6 w-6" />
  </div>
          <div className="relative left-2">
          <span className="font-semibold">Step 3</span>
          <span className="text-[10px] flex items-center gap-1">Add Photos</span>
          </div>
        </Button>
      </div>

      {/* ✅ Show if permissions blocked */}
      {(cameraStatus === "denied" || locationStatus === "denied") && (
        <div className="text-red-500 text-xs bg-red-50 p-2 rounded-md">
          Permissions are blocked.<br />
          Please enable Camera & Location from:<br />
          <strong>Settings → Apps → Browser → Permissions</strong>
        </div>
      )}
      

    </div>
  );
};

export default PhotoPermissionChecker;
