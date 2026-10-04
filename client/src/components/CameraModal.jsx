import { useState, useRef, useEffect, useCallback } from 'react';

import { IoClose, IoCamera, IoCameraReverse } from 'react-icons/io5';

import { requestMediaStream, mediaErrorMessagePt } from '../utils/mediaDevices';
import { dataUrlToJpegFile } from '../utils/imageEditCanvas';



export default function CameraModal({ open, onClose, onCapture }) {

  const videoRef = useRef(null);

  const canvasRef = useRef(null);

  const streamRef = useRef(null);

  const [facingMode, setFacingMode] = useState('user');

  const [captured, setCaptured] = useState(null);

  const [error, setError] = useState(null);

  /** No iOS/Safari, getUserMedia deve correr no mesmo toque do utilizador — não ao abrir o modal. */

  const [cameraActive, setCameraActive] = useState(false);



  const stopTracks = useCallback(() => {

    if (streamRef.current) {

      streamRef.current.getTracks().forEach((t) => t.stop());

      streamRef.current = null;

    }

    if (videoRef.current) {

      videoRef.current.srcObject = null;

    }

  }, []);



  const startCamera = useCallback(

    async (facing) => {

      stopTracks();

      setError(null);

      try {

        const stream = await requestMediaStream({

          video: {

            facingMode: facing,

            width: { ideal: 1280 },

            height: { ideal: 720 },

          },

          audio: false,

        });

        streamRef.current = stream;

        if (videoRef.current) {

          videoRef.current.srcObject = stream;

        }

        setCameraActive(true);

        return true;

      } catch (err) {

        console.error(err);

        setError(mediaErrorMessagePt(err));

        setCameraActive(false);

        return false;

      }

    },

    [stopTracks]

  );



  useEffect(() => {

    if (!open) return undefined;

    setCaptured(null);

    setError(null);

    setCameraActive(false);

    stopTracks();

    return () => {

      stopTracks();

    };

  }, [open, stopTracks]);



  const handleAllowCamera = async () => {

    await startCamera(facingMode);

  };



  const switchCamera = async () => {

    const next = facingMode === 'user' ? 'environment' : 'user';

    setFacingMode(next);

    if (cameraActive || captured) {

      setCaptured(null);

      await startCamera(next);

    }

  };



  const takePhoto = () => {

    const video = videoRef.current;

    const canvas = canvasRef.current;

    if (!video || !canvas) return;



    canvas.width = video.videoWidth;

    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');

    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    stopTracks();

    setCameraActive(false);

    setCaptured(dataUrl);

  };



  const retake = async () => {

    setCaptured(null);

    await startCamera(facingMode);

  };



  const sendPhoto = async () => {

    if (!captured) return;

    const file = await dataUrlToJpegFile(captured, `photo_${Date.now()}.jpg`);

    onCapture(file);

    onClose();

  };



  if (!open) return null;



  return (

    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">

      <div className="relative w-full max-w-lg mx-4 bg-whatsapp-sidebar rounded-2xl overflow-hidden shadow-2xl">

        <div className="flex items-center justify-between px-4 py-3 bg-whatsapp-header">

          <h3 className="text-white font-medium">Câmara</h3>

          <button

            type="button"

            onClick={onClose}

            className="p-1 rounded-full text-whatsapp-text-secondary hover:bg-whatsapp-hover hover:text-white"

          >

            <IoClose className="w-6 h-6" />

          </button>

        </div>



        <div className="relative aspect-[4/3] bg-black">

          {error ? (

            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-whatsapp-text-secondary text-sm px-6 text-center">

              <p>{error}</p>

              <button

                type="button"

                onClick={handleAllowCamera}

                className="rounded-lg bg-whatsapp-green px-4 py-2 text-sm font-semibold text-white"

              >

                Tentar outra vez

              </button>

            </div>

          ) : captured ? (

            <img src={captured} alt="Foto capturada" className="w-full h-full object-contain" />

          ) : !cameraActive ? (

            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">

              <p className="text-sm text-whatsapp-text-secondary">

                Toque no botão abaixo para o Safari pedir permissão da câmara.

              </p>

              <button

                type="button"

                onClick={handleAllowCamera}

                className="rounded-xl bg-whatsapp-green px-6 py-3 text-base font-semibold text-white shadow-lg"

              >

                Permitir câmara

              </button>

            </div>

          ) : (

            <video

              ref={videoRef}

              autoPlay

              playsInline

              muted

              className={`w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}

            />

          )}

        </div>



        <canvas ref={canvasRef} className="hidden" />



        <div className="flex items-center justify-center gap-4 py-4 px-4">

          {captured ? (

            <>

              <button

                type="button"

                onClick={retake}

                className="px-5 py-2.5 rounded-lg bg-whatsapp-hover text-whatsapp-text text-sm font-medium hover:bg-whatsapp-input transition-colors"

              >

                Repetir

              </button>

              <button

                type="button"

                onClick={sendPhoto}

                className="px-5 py-2.5 rounded-lg bg-whatsapp-green text-white text-sm font-medium hover:bg-whatsapp-green/80 transition-colors"

              >

                Enviar

              </button>

            </>

          ) : cameraActive ? (

            <>

              <button

                type="button"

                onClick={switchCamera}

                className="p-3 rounded-full bg-whatsapp-hover text-whatsapp-text hover:bg-whatsapp-input transition-colors"

                aria-label="Trocar câmara"

              >

                <IoCameraReverse className="w-6 h-6" />

              </button>

              <button

                type="button"

                onClick={takePhoto}

                className="p-4 rounded-full bg-white text-black hover:bg-white/90 transition-colors"

                aria-label="Tirar foto"

              >

                <IoCamera className="w-8 h-8" />

              </button>

              <div className="w-12" />

            </>

          ) : null}

        </div>

      </div>

    </div>

  );

}


