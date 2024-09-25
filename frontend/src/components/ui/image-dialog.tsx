import React, { useState, useCallback, useEffect } from 'react'
import ReactDOM from 'react-dom'
import Cropper from 'react-easy-crop'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
// import Typography from '@material-ui/core/Typography'
import { getOrientation } from 'get-orientation/browser'
// import ImgDialog from './ImgDialog'
import { getCroppedImg, getRotatedImage } from "@/components/image/canvas-utils"
import { Dialog, DialogClose, DialogContent, DialogOverlay, DialogTrigger } from '@radix-ui/react-dialog'
import { DialogHeader } from './dialog'

const ORIENTATION_TO_ANGLE = {
    '3': 180,
    '6': 90,
    '8': -90,
}

export default function ImageCrop({ imageFile, onCroppedImage }) {
    const [imageSrc, setImageSrc] = React.useState(null)
    const [crop, setCrop] = useState({ x: 0, y: 0 })
    const [rotation, setRotation] = useState(0)
    const [zoom, setZoom] = useState(1)
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
    const [croppedImage, setCroppedImage] = useState(null)

    useEffect(() => {
        const loadImage = async () => {
            if (imageFile) {
                let imageDataUrl = await readFile(imageFile)
                try {
                    const orientation = await getOrientation(imageFile)
                    const rotation = ORIENTATION_TO_ANGLE[orientation]
                    if (rotation) {
                        imageDataUrl = await getRotatedImage(imageDataUrl, rotation)
                    }
                } catch (e) {
                    console.warn('failed to detect the orientation')
                }
                setImageSrc(imageDataUrl)
            }
        }

        loadImage()
    }, [imageFile])

    const onCropComplete = (croppedArea, croppedAreaPixels) => {
        setCroppedAreaPixels(croppedAreaPixels)
    }

    const showCroppedImage = useCallback(async () => {
        try {
            const croppedImage = await getCroppedImg(imageSrc, croppedAreaPixels, rotation)
            setCroppedImage(croppedImage)
            onCroppedImage(croppedImage)
        } catch (e) {
            console.error(e)
        }
    }, [imageSrc, croppedAreaPixels, rotation, onCroppedImage])

    // const onClose = () => {
    //     setCroppedImage(null)
    // }

    return (
        <div>
            {/* <Dialog>
                <DialogTrigger asChild>
                    <Button>Edit Image</Button>
                </DialogTrigger>
                <DialogOverlay className="dialogOverlay" />
                <DialogContent className="dialogContent">
                    <DialogHeader> */}
            <div className="relative w-full h-60 mt-4 overflow-hidden">
                <Cropper
                    image={imageSrc}
                    crop={crop}
                    rotation={rotation}
                    zoom={zoom}
                    aspect={4 / 3}
                    onCropChange={setCrop}
                    onRotationChange={setRotation}
                    onCropComplete={onCropComplete}
                    onZoomChange={setZoom}

                />
            </div>
            <div >
                <div className="py-4">
                    <Slider
                        value={[zoom]}
                        min={1}
                        max={3}
                        step={0.1}
                        aria-labelledby="Zoom"
                        onValueChange={([zoom]) => setZoom(zoom)}
                    />
                </div>
                <div className="py-4">
                    <Slider
                        value={[rotation]}
                        min={0}
                        max={360}
                        step={1}
                        aria-labelledby="Rotation"
                        onValueChange={([rotation]) => setRotation(rotation)}
                    />
                </div>
                <Button
                    onClick={showCroppedImage}
                    color="primary"
                >
                    Show Result
                </Button>
            </div>
            {/* </DialogHeader> */}
            {/* <ImgDialog img={croppedImage} onClose={onClose} /> */}
            {/* </DialogContent>

            </Dialog> */}
        </div>
    )
}



function readFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader()
        reader.addEventListener('load', () => resolve(reader.result), false)
        reader.readAsDataURL(file)
    })
}