import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { PurchaseScreen } from './PurchaseScreen';
import { INITIAL_GENERAL_DATA } from '../../constants';
import { getDatosGenerales, saveImageAssetFile } from '../../services/apiService';
import insigniaGeneric from '../../src/insignia_generic.png';
import jecIconGeneric from '../../src/jec_icon_generic.jpg';
import logoBar from '../../src/Logo_bar.ico';
import armarIcon from '../../src/armar_icon.ico';
import type { GeneralData } from '../../types';
import {
  broadcastGeneralImagesUpdate,
  GENERAL_IMAGES_UPDATED_EVENT,
  persistGeneralImageField,
  readStoredGeneralImages,
} from '../../utils/generalImageHelpers';
import {
  PROFILE_IMAGE_UPDATED_EVENT,
  persistProfileImageAsset,
  persistProfileImage,
  readImageFileAsDataUrl,
  resolveBestProfileImageSource,
  resolveProfileImageStorageKey,
} from '../../utils/imageStorage';

const buildRoundedRegularPolygonPath = ({
  sides,
  centerX,
  centerY,
  radius,
  cornerRadius,
  rotationDeg = 0,
}: {
  sides: number;
  centerX: number;
  centerY: number;
  radius: number;
  cornerRadius: number;
  rotationDeg?: number;
}) => {
  const step = (Math.PI * 2) / sides;
  const rotation = (rotationDeg * Math.PI) / 180;
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = rotation + step * index;
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });

  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(b.x - a.x, b.y - a.y);

  const moveTowards = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    amount: number
  ) => {
    const total = distance(from, to) || 1;
    return {
      x: from.x + ((to.x - from.x) * amount) / total,
      y: from.y + ((to.y - from.y) * amount) / total,
    };
  };

  const rounded = points.map((point, index) => {
    const prev = points[(index - 1 + sides) % sides];
    const next = points[(index + 1) % sides];
    const maxInset = Math.min(distance(point, prev), distance(point, next)) / 2.4;
    const inset = Math.min(cornerRadius, maxInset);

    return {
      start: moveTowards(point, prev, inset),
      corner: point,
      end: moveTowards(point, next, inset),
    };
  });

  const first = rounded[0];
  const commands = [`M ${first.end.x.toFixed(2)} ${first.end.y.toFixed(2)}`];

  rounded.forEach((segment, index) => {
    const next = rounded[(index + 1) % sides];
    commands.push(`L ${next.start.x.toFixed(2)} ${next.start.y.toFixed(2)}`);
    commands.push(`Q ${next.corner.x.toFixed(2)} ${next.corner.y.toFixed(2)} ${next.end.x.toFixed(2)} ${next.end.y.toFixed(2)}`);
  });

  commands.push('Z');
  return commands.join(' ');
};

const buildRoundedPolygonPath = (
  points: Array<{ x: number; y: number }>,
  cornerRadius: number
) => {
  const totalPoints = points.length;

  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(b.x - a.x, b.y - a.y);

  const moveTowards = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    amount: number
  ) => {
    const total = distance(from, to) || 1;
    return {
      x: from.x + ((to.x - from.x) * amount) / total,
      y: from.y + ((to.y - from.y) * amount) / total,
    };
  };

  const rounded = points.map((point, index) => {
    const prev = points[(index - 1 + totalPoints) % totalPoints];
    const next = points[(index + 1) % totalPoints];
    const maxInset = Math.min(distance(point, prev), distance(point, next)) / 2.4;
    const inset = Math.min(cornerRadius, maxInset);

    return {
      start: moveTowards(point, prev, inset),
      corner: point,
      end: moveTowards(point, next, inset),
    };
  });

  const first = rounded[0];
  const commands = [`M ${first.end.x.toFixed(2)} ${first.end.y.toFixed(2)}`];

  rounded.forEach((_, index) => {
    const next = rounded[(index + 1) % totalPoints];
    commands.push(`L ${next.start.x.toFixed(2)} ${next.start.y.toFixed(2)}`);
    commands.push(`Q ${next.corner.x.toFixed(2)} ${next.corner.y.toFixed(2)} ${next.end.x.toFixed(2)} ${next.end.y.toFixed(2)}`);
  });

  commands.push('Z');
  return commands.join(' ');
};

const mainHexPath = buildRoundedRegularPolygonPath({
  sides: 6,
  centerX: 200,
  centerY: 200,
  radius: 230, //Esquina redondeadas de hexagono grande, no tocar
  cornerRadius: 35,
  rotationDeg: -60,
});
const fieldPath = buildRoundedPolygonPath(
  [
    { x: 34, y: 6 },
    { x: 378, y: 6 },
    { x: 414, y: 58 },
    { x: 378, y: 110 },
    { x: 34, y: 110 },
    { x: -2, y: 58 },
  ],
  10
);
const smallHexFramePath = buildRoundedRegularPolygonPath({
  sides: 6,
  centerX: 50,
  centerY: 50,
  radius: 44,
  cornerRadius: 6,
  rotationDeg: -90,
});

const smallHexInnerPath = buildRoundedRegularPolygonPath({
  sides: 6,
  centerX: 50,
  centerY: 50,
  radius: 44,
  cornerRadius: 4,
  rotationDeg: -60,
});

const buttonHexPath = `
  M 22 4
  L 38 4
  Q 44 4 48 9
  L 56 22
  Q 60 28 60 34
  L 60 36
  Q 60 42 56 48
  L 48 61
  Q 44 66 38 66
  L 22 66
  Q 16 66 12 61
  L 4 48
  Q 0 42 0 36
  L 0 34
  Q 0 28 4 22
  L 12 9
  Q 16 4 22 4
  Z
`;



const HexImage = ({
  src,
  alt,
  size,
  className = '',
}: {
  src: string;
  alt: string;
  size: number;
  className?: string;
}) => (
  <div
    className={`relative shrink-0 rotate-[30deg] ${className}`}
    style={{ width: size, height: size }}
  >
    <svg
      className="absolute inset-0 h-full w-full drop-shadow-[0_8px_18px_rgba(15,23,42,0.16)]"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <path d={smallHexFramePath} fill="white" />
    </svg>

    <svg
      className="absolute inset-[4px] h-[calc(100%-8px)] w-[calc(100%-8px)] -rotate-[30deg]"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={`hex-clip-${alt.replace(/\s+/g, '-').toLowerCase()}`}>
          <path d={smallHexInnerPath} />
        </clipPath>
      </defs>

      <image
        href={src}
        x="0"
        y="0"
        width="100"
        height="100"
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#hex-clip-${alt.replace(/\s+/g, '-').toLowerCase()})`}
      />
    </svg>
  </div>
);








const PlusBadge = () => (
  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-[#7a3cff] text-[11px] font-black leading-none text-white shadow-[0_4px_10px_rgba(0,0,0,0.18)] transition duration-200 group-hover:scale-110 group-hover:shadow-[0_6px_14px_rgba(91,33,182,0.35)]">
    +
  </span>
);

const HEX_HITBOX_STYLE = {
  clipPath: 'polygon(50% 2%, 93% 25%, 93% 75%, 50% 98%, 7% 75%, 7% 25%)',
};

const BottomAction = ({
  icon,
  label,
  href,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
}) => (
  <button
    type="button"
    onClick={() => {
      if (onClick) {
        onClick();
        return;
      }
      if (href) window.open(href, '_blank', 'noopener,noreferrer');
    }}
    className="flex min-w-0 flex-col items-center gap-0.5 text-[8px] leading-none text-slate-950 transition hover:-translate-y-0.5"
  >
    <span className="flex h-4.5 w-4.5 items-center justify-center text-slate-950">{icon}</span>
    <span className="whitespace-nowrap">{label}</span>
  </button>
);

const UserIcon = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.418 0-8 2.239-8 5v1h16v-1c0-2.761-3.582-5-8-5Z" />
  </svg>
);

const LockIcon = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-6 0V7a1 1 0 1 1 2 0v2Z" />
  </svg>
);

const EyeToggle = ({ visible }: { visible: boolean }) => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
    {visible ? (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ) : (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9a3 3 0 0 1 3 3" />
      </>
    )}
  </svg>
);

const SupportIcon = () => (
  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3a9 9 0 0 0-9 9v1a3 3 0 0 0 3 3h2v-7H5.07A7 7 0 0 1 19 12h-2.93v7H18a3 3 0 0 0 3-3v-4a9 9 0 0 0-9-9Z" />
  </svg>
);

const CartIcon = () => (
  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 18a2 2 0 1 0 2 2 2 2 0 0 0-2-2Zm10 0a2 2 0 1 0 2 2 2 2 0 0 0-2-2ZM6.2 6l.4 2H20l-1.6 6.4a2 2 0 0 1-1.94 1.6H9.24a2 2 0 0 1-1.95-1.56L4.3 4H2V2h3.9a1 1 0 0 1 .98.8L7.2 4H22v2Z" />
  </svg>
);

const HelpIcon = () => (
  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2a10 10 0 1 0 10 10A10.01 10.01 0 0 0 12 2Zm.1 15.5a1.15 1.15 0 1 1 1.15-1.15 1.15 1.15 0 0 1-1.15 1.15Zm1.74-6.65-.78.53a2.1 2.1 0 0 0-1 1.87v.25h-2v-.35a3.61 3.61 0 0 1 1.67-3.09l1.08-.72a1.56 1.56 0 0 0 .73-1.32 1.83 1.83 0 0 0-3.65-.13H7.86a3.83 3.83 0 1 1 7.65.27 3.5 3.5 0 0 1-1.67 2.69Z" />
  </svg>
);

const InfoIcon = () => (
  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11 10h2v7h-2Zm0-4h2v2h-2Zm1 16A10 10 0 1 1 22 12 10.01 10.01 0 0 1 12 22Z" />
  </svg>
);

const GlobeIcon = () => (
  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2a10 10 0 1 0 10 10A10.01 10.01 0 0 0 12 2Zm6.92 9h-3.1a15.72 15.72 0 0 0-1.1-4A8.03 8.03 0 0 1 18.92 11ZM12 4.04c.82 1.12 1.85 3.31 2.18 6H9.82c.33-2.69 1.36-4.88 2.18-6ZM4.08 13h3.1a15.72 15.72 0 0 0 1.1 4A8.03 8.03 0 0 1 4.08 13Zm3.1-2h-3.1A8.03 8.03 0 0 1 8.28 7a15.72 15.72 0 0 0-1.1 4Zm4.82 8c-.82-1.12-1.85-3.31-2.18-6h4.36c-.33 2.69-1.36 4.88-2.18 6Zm2.72-2a15.72 15.72 0 0 0 1.1-4h3.1A8.03 8.03 0 0 1 14.72 17Z" />
  </svg>
);

export const LoginScreen: React.FC = () => {
  const { login, loginAsDeveloper, session } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [generalData, setGeneralData] = useState<GeneralData>(INITIAL_GENERAL_DATA);
  const [insigniaImage, setInsigniaImage] = useState<string>(insigniaGeneric);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [logoImage, setLogoImage] = useState<string>(jecIconGeneric);
  const [showPurchase, setShowPurchase] = useState(false);
  const insigniaInputRef = useRef<HTMLInputElement>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const canSubmit = useMemo(
    () => username.trim().length > 0 && password.trim().length > 0 && !submitting,
    [password, submitting, username]
  );

  useEffect(() => {
    let active = true;

    const loadImageState = async () => {
      const data = await getDatosGenerales();
      if (!active) return;

      const storedGeneralImages = readStoredGeneralImages();
      const effectiveInsignia = storedGeneralImages?.insignia || data.insignia || insigniaGeneric;
      const effectiveLogo = storedGeneralImages?.logo || data.logo || jecIconGeneric;

      setGeneralData(data);
      setInsigniaImage(effectiveInsignia);
      setLogoImage(effectiveLogo);

      const savedProfile = await resolveBestProfileImageSource(session);
      if (!active) return;
      setProfileImage(savedProfile || null);
    };

    void loadImageState();

    const handleProfileUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<string | null>;
      if (customEvent.detail) {
        setProfileImage(customEvent.detail);
        return;
      }
      void resolveBestProfileImageSource(session).then((nextImage) => {
        if (active) setProfileImage(nextImage || null);
      });
    };

    const handleGeneralImagesUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ insignia?: string; logo?: string }>;
      const next = customEvent.detail || readStoredGeneralImages() || {};
      setInsigniaImage(next.insignia || insigniaGeneric);
      setLogoImage(next.logo || jecIconGeneric);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== 'armi_general_images_state') return;
      const next = readStoredGeneralImages() || {};
      setInsigniaImage(next.insignia || insigniaGeneric);
      setLogoImage(next.logo || jecIconGeneric);
    };

    window.addEventListener(PROFILE_IMAGE_UPDATED_EVENT, handleProfileUpdated as EventListener);
    window.addEventListener(GENERAL_IMAGES_UPDATED_EVENT, handleGeneralImagesUpdated as EventListener);
    window.addEventListener('storage', handleStorage);

    return () => {
      active = false;
      window.removeEventListener(PROFILE_IMAGE_UPDATED_EVENT, handleProfileUpdated as EventListener);
      window.removeEventListener(GENERAL_IMAGES_UPDATED_EVENT, handleGeneralImagesUpdated as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, [session]);

  const handleImageSelection = async (
    event: React.ChangeEvent<HTMLInputElement>,
    target: 'insignia' | 'profile' | 'logo'
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const dataUrl = await readImageFileAsDataUrl(file);

      if (target === 'profile') {
        persistProfileImage(dataUrl, session);
        setProfileImage(dataUrl);
        setMessage(null);
        void saveImageAssetFile({
          imageData: dataUrl,
          kind: 'profile',
          userKey: resolveProfileImageStorageKey(session).replace('armi_profile_image::', ''),
        }).then((response) => {
          if (response.success && response.data?.fileUrl) {
            persistProfileImageAsset(response.data.fileUrl, session);
          }
        });
        return;
      }

      const { result, nextData } = await persistGeneralImageField(generalData, target, dataUrl);
      if (!result.success) {
        setMessage(result.message || 'No se pudo guardar la imagen.');
        return;
      }

      setGeneralData(nextData);
      setMessage(null);
      const optimizedImage = target === 'insignia' ? nextData.insignia : nextData.logo;
      if (target === 'insignia') {
        setInsigniaImage(optimizedImage);
      } else {
        setLogoImage(optimizedImage);
      }
      broadcastGeneralImagesUpdate({
        insignia: nextData.insignia,
        logo: nextData.logo,
      });
      void saveImageAssetFile({
        imageData: optimizedImage,
        kind: target === 'insignia' ? 'general_insignia' : 'general_logo',
        alreadyOptimized: true,
      });
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : 'No se pudo procesar la imagen.';
      setMessage(nextMessage);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage(null);
    const result = await login({ username, password, remember });
    if (!result.success) {
      setMessage(result.message || 'No se pudo iniciar sesión.');
    }
    setSubmitting(false);
  };

  if (showPurchase) {
    return <PurchaseScreen onBack={() => setShowPurchase(false)} />;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent">
      <input
        ref={insigniaInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleImageSelection(event, 'insignia')}
      />
      <input
        ref={profileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleImageSelection(event, 'profile')}
      />
      <input
        ref={logoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleImageSelection(event, 'logo')}
      />
      <div className="relative flex min-h-screen items-center justify-center px-3 py-3">
        <div className="relative w-full max-w-[420px]">
          <div className="relative mx-auto w-full max-w-[325px] pt-[42px]">
            <div className="absolute left-1/2 top-[1px] z-30 flex -translate-x-1/2 ml-[7px] items-end gap-0.5 pointer-events-none">

              
              <div className="group relative z-20 -top-6 translate-x-7 pointer-events-auto">
                <HexImage src={insigniaImage} alt="Insignia genérica" size={70} />
                <button
                  type="button"
                  className="peer absolute left-0 top-0 z-30 h-full w-[96px] rotate-[30deg] pointer-events-auto opacity-0"
                  style={HEX_HITBOX_STYLE}
                  onClick={() => insigniaInputRef.current?.click()}
                  aria-label="Seleccionar insignia"
                />
                <div className="group pointer-events-none absolute bottom-[2px] right-[2px] opacity-0 translate-y-1 transition duration-200 peer-hover:opacity-100 peer-hover:translate-y-0 peer-focus-visible:opacity-100 peer-focus-visible:translate-y-0">
                  <PlusBadge />
                </div>
              </div>

              <div className="group relative -top-7 pointer-events-auto">
                <HexImage src={profileImage || logoBar} alt="Perfil genérico" size={120} />
                <button type="button" className="peer absolute inset-0 z-10 rotate-[30deg] pointer-events-auto opacity-0" style={HEX_HITBOX_STYLE} onClick={() => profileInputRef.current?.click()} aria-label="Seleccionar imagen de perfil" />
                <div className="group pointer-events-none absolute bottom-[6px] right-[20px] opacity-0 translate-y-1 transition duration-200 peer-hover:opacity-100 peer-hover:translate-y-0 peer-focus-visible:opacity-100 peer-focus-visible:translate-y-0">
                  <PlusBadge />
                </div>
              </div>

              <div className="group relative -top-6 -translate-x-7 pointer-events-auto">
                <HexImage src={logoImage} alt="Icono genérico" size={70} />
                <button type="button" className="peer absolute inset-0 z-10 rotate-[30deg] pointer-events-auto opacity-0" style={HEX_HITBOX_STYLE} onClick={() => logoInputRef.current?.click()} aria-label="Seleccionar logo institucional" />
                <div className="group pointer-events-none absolute bottom-[2px] right-[2px] opacity-0 translate-y-1 transition duration-200 peer-hover:opacity-100 peer-hover:translate-y-0 peer-focus-visible:opacity-100 peer-focus-visible:translate-y-0">
                  <PlusBadge />
                </div>
              </div>
            </div>


<div className="relative h-[340px] w-[340px] overflow-visible">
  <svg
    className="absolute inset-0 h-full w-full overflow-visible rotate-[0deg]"
    viewBox="0 0 400 400"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    <path
      d={mainHexPath}
      fill="rgba(169, 227, 219, 0.88)"
      stroke="rgba(255,255,255,0.35)"
      strokeWidth="2"
    />
  </svg>

  <div className="absolute inset-0 flex flex-col items-center px-4 pt-[58px] pb-5">
                     

              <div className="relative z-10 text-center">
                <div className="mx-auto flex w-fit items-center gap-1.5">
                  <img src={armarIcon} alt="Armar" className="h-5.5 w-5.5 rounded-full bg-white object-contain p-1 shadow-sm" />
                  <span className="text-[0.78rem] font-black tracking-tight text-[#005768]">ARMAR</span>
                </div>

                <p className={`mt-1 text-center text-[0.64rem] font-semibold text-white drop-shadow-sm ${!message && !profileImage ? 'animate-pulse' : ''}`}>
                  {message || (!profileImage ? 'Imagen de perfil no encontrada.' : '')}
                </p>
              </div>

              <form className="relative z-10 mt-3 w-[80%] space-y-2" onSubmit={handleSubmit}>
                <div className="relative left-1/2 h-[50px] w-[100%] -translate-x-1/2">
                <svg
                  className="absolute inset-0 h-full w-full drop-shadow-[0_5px_12px_rgba(15,23,42,0.08)]"
                  viewBox="-8 0 428 116"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d={fieldPath} fill="white" stroke="white" strokeWidth="2" />
                </svg>

                <div className="absolute inset-0 flex items-center">
                  <div className="flex h-full w-[48px] translate-x-[25px] items-center justify-center text-black">
                    <UserIcon />
                  </div>
                  <div className="relative translate-x-[30px] shrink-0 h-7 w-px bg-slate-500" />

                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="h-full flex-1 bg-transparent px-12 text-[0.86rem] font-medium tracking-[0.01em] text-[#157991] outline-none placeholder:text-slate-300"
                    placeholder="Usuario"
                    autoComplete="username"
                  />
                </div>
              </div>

                <div className="relative left-1/2 h-[50px] w-[100%] -translate-x-1/2">
                  <svg
                    className="absolute inset-0 h-full w-full drop-shadow-[0_5px_12px_rgba(15,23,42,0.08)]"
                    viewBox="-8 0 428 116"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path d={fieldPath} fill="white" stroke="white" strokeWidth="2" />
                  </svg>

                  <div className="absolute inset-0 flex items-center">
                    <div className="flex h-full w-[48px] translate-x-[25px] items-center justify-center text-black">
                      <LockIcon />
                    </div>

                    <div className="relative translate-x-[30px] shrink-0 h-7 w-px bg-slate-500" />

                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-full flex-1 bg-transparent px-12 text-[0.86rem] font-medium tracking-[0.12em] text-[#157991] outline-none placeholder:text-slate-300"
                      placeholder="********"
                      autoComplete="current-password"
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="mr-5 -translate-x-[90px] text-black transition hover:text-slate-700"

                    >
                      <EyeToggle visible={showPassword} />
                    </button>
                  </div>
                </div>

                <div className="mx-auto mt-1 flex w-[88%] items-center justify-center gap-5">
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="relative flex h-[38px] min-w-[112px] items-center justify-center px-5 text-[0.9rem] font-black tracking-[0.01em] text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg
                      className="absolute inset-0 h-full w-full drop-shadow-[0_4px_0_rgba(7,90,115,0.75)]"
                      viewBox="0 0 180 70"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <defs>
                        <linearGradient id="enterHexGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1687a5" />
                          <stop offset="100%" stopColor="#0b6e8a" />
                        </linearGradient>
                      </defs>
                      <path
                        d="M 24 6 L 156 6 Q 166 6 172 15 L 178 30 Q 180 34 180 35 Q 180 36 178 40 L 172 55 Q 166 64 156 64 L 24 64 Q 14 64 8 55 L 2 40 Q 0 36 0 35 Q 0 34 2 30 L 8 15 Q 14 6 24 6 Z"
                        fill="url(#enterHexGradient)"
                        stroke="#1e7a96"
                        strokeWidth="2"
                      />
                    </svg>
                    <span className="relative z-10">{submitting ? 'Entrando' : 'Entrar'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => window.close()}
                    className="relative flex h-[35px] w-[35px] items-center justify-center text-[1.2rem] font-black text-white transition hover:-translate-y-0.5"
                  >
                    <svg
                      className="absolute inset-0 h-full w-full rotate-[30deg] drop-shadow-[0_4px_0_rgba(7,90,115,0.75)]"
                      viewBox="0 0 60 70"
                      preserveAspectRatio="xMidYMid meet"
                      aria-hidden="true"
                    >
                      <defs>
                        <linearGradient id="closeHexGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1687a5" />
                          <stop offset="100%" stopColor="#0b6e8a" />
                        </linearGradient>
                      </defs>
                      <path d={buttonHexPath} fill="url(#closeHexGradient)" stroke="#1e7a96" strokeWidth="2" />
                    </svg>
                    <span className="relative z-10">×</span>
                  </button>
                </div>

                <label className="mt-2 flex items-center justify-center gap-1.5 text-[0.6rem] text-slate-800">
                  <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-3 w-3" />
                  <span>Recordar login</span>
                </label>

                <button
                  type="button"
                  onClick={loginAsDeveloper}
                  className="mx-auto flex h-[30px] w-[84%] items-center justify-center rounded-md border border-cyan-700/25 bg-white/80 px-3 text-[0.62rem] font-black uppercase tracking-[0.08em] text-[#005768] shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
                  title="Entrar en modo desarrollo con todos los modulos activos"
                >
                  Acceso completo
                </button>
              </form>

              <div className="relative z-10 mt-2 flex w-[84%] items-start justify-center gap-2.5 self-center">
                <BottomAction icon={<SupportIcon />} label="Soporte" />
                <BottomAction icon={<CartIcon />} label="Compra" onClick={() => setShowPurchase(true)} />
                <BottomAction icon={<HelpIcon />} label="Ayuda" />
                <BottomAction icon={<InfoIcon />} label="Acerca de" />
                <BottomAction icon={<GlobeIcon />} label="Web" href="https://sites.google.com/view/terminos-armi-docente/armar" />
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};
