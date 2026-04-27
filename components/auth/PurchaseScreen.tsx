import React, { useEffect, useMemo, useRef, useState } from 'react';
import { checkPurchaseStatus, getPurchaseConfig, submitPurchaseRequest } from '../../services/apiService';
import armarIcon from '../../src/armar_icon.ico';
import logoBar from '../../src/Logo_bar.ico';

interface PurchaseScreenProps {
  onBack: () => void;
}

interface PurchaseForm {
  nombres: string;
  dni: string;
  lugar: string;
  ie: string;
  especialidad: string;
  usuario: string;
  contrasena: string;
  gmail: string;
  outlook: string;
  telegram: string;
  whatsapp: string;
  terminos: boolean;
}

interface PurchaseCache {
  dni: string;
  usuario: string;
  estado?: string;
  active?: boolean;
  pending?: boolean;
  message?: string;
  savedAt: string;
}

interface PurchasePaymentConfig {
  yapeQrUrl: string;
  paymentAmount: string;
  paymentReceiver: string;
}

const PURCHASE_CACHE_KEY = 'armi_purchase_request_v1';
const requiredTouchedFields = ['nombres', 'dni', 'ie', 'usuario', 'contrasena', 'gmail'] as const;

const initialForm: PurchaseForm = {
  nombres: '',
  dni: '',
  lugar: '',
  ie: '',
  especialidad: '',
  usuario: '',
  contrasena: '',
  gmail: '',
  outlook: '',
  telegram: '',
  whatsapp: '',
  terminos: false,
};

const onlyDigits = (value: string, maxLength: number) => value.replace(/\D/g, '').slice(0, maxLength);
const normalizeEmail = (value: string) => value.replace(/\s/g, '').slice(0, 90);
const normalizeUsername = (value: string) => value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24);
const normalizeTelegram = (value: string) => {
  const clean = value.replace(/^@+/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
  return clean ? `@${clean}` : '';
};
const isValidEmail = (value: string) => !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const isStrongPassword = (value: string) =>
  value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);

const normalizeQrImageUrl = (value: string) => {
  const url = value.trim();
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i) || url.match(/[?&]id=([^&]+)/i);
  if (driveMatch?.[1]) return `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w1000`;
  return url;
};

const compressImageFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen del comprobante.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('La imagen seleccionada no se pudo procesar.'));
      image.onload = () => {
        const maxSide = 900;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('No se pudo preparar la imagen.'));
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        let quality = 0.68;
        let output = canvas.toDataURL('image/jpeg', quality);
        while (output.length > 900_000 && quality > 0.38) {
          quality -= 0.1;
          output = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(output);
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });

const Field = ({
  label,
  value,
  onChange,
  type = 'text',
  className = '',
  inputMode,
  maxLength,
  autoComplete,
  error,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
  autoComplete?: string;
  error?: string;
  onBlur?: () => void;
}) => (
  <label className={`block ${className}`}>
    <span className="mb-1 block text-[11px] font-black text-slate-500">{label}</span>
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputMode={inputMode}
      maxLength={maxLength}
      autoComplete={autoComplete}
      onBlur={onBlur}
      aria-invalid={!!error}
      className="h-8 w-full rounded-full border border-slate-300 bg-white/80 px-4 text-[13px] font-semibold text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
    />
    {error ? <p className="mt-1 animate-pulse text-[10px] font-black text-red-600">{error}</p> : null}
  </label>
);

const ContactButton = ({ label, href, tone }: { label: string; href: string; tone: string }) => (
  <button
    type="button"
    onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
    className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-black text-white shadow-lg transition hover:-translate-y-1 ${tone}`}
    title={label}
  >
    {label.slice(0, 2)}
  </button>
);

export const PurchaseScreen: React.FC<PurchaseScreenProps> = ({ onBack }) => {
  const [form, setForm] = useState<PurchaseForm>(initialForm);
  const [receiptData, setReceiptData] = useState('');
  const [receiptName, setReceiptName] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<keyof PurchaseForm | 'receipt', boolean>>>({});
  const [paymentConfig, setPaymentConfig] = useState<PurchasePaymentConfig>({
    yapeQrUrl: '',
    paymentAmount: '100',
    paymentReceiver: 'Kevin Arnold Horna Quispe',
  });
  const [paymentConfigLoading, setPaymentConfigLoading] = useState(true);
  const [qrLoading, setQrLoading] = useState(true);
  const [qrLoadFailed, setQrLoadFailed] = useState(false);
  const [purchaseCache, setPurchaseCache] = useState<PurchaseCache | null>(() => {
    try {
      const raw = window.localStorage.getItem(PURCHASE_CACHE_KEY);
      return raw ? JSON.parse(raw) as PurchaseCache : null;
    } catch {
      return null;
    }
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = (key: keyof PurchaseForm, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  };

  const markTouched = (key: keyof PurchaseForm | 'receipt') => {
    setTouched((prev) => ({ ...prev, [key]: true }));
  };

  const validationErrors = useMemo(() => {
    const errors: Partial<Record<keyof PurchaseForm | 'receipt', string>> = {};
    if (form.nombres.trim().length < 5) errors.nombres = 'Ingresa apellidos y nombres completos.';
    if (form.dni.length !== 8) errors.dni = 'El DNI debe tener exactamente 8 numeros.';
    if (form.ie.trim().length < 3) errors.ie = 'Ingresa tu institucion educativa.';
    if (form.usuario.length < 4) errors.usuario = 'Minimo 4 caracteres: letras, numeros, punto, guion o guion bajo.';
    if (!isStrongPassword(form.contrasena)) {
      errors.contrasena = 'Minimo 8 caracteres, mayuscula, minuscula, numero y simbolo.';
    }
    if (!form.gmail.trim()) errors.gmail = 'El Gmail es obligatorio para comunicar la verificacion.';
    else if (!isValidEmail(form.gmail)) errors.gmail = 'El Gmail no tiene un formato valido.';
    if (form.outlook && !isValidEmail(form.outlook)) errors.outlook = 'Este correo no tiene un formato valido.';
    if (form.telegram && !/^@[a-zA-Z0-9_]{5,32}$/.test(form.telegram)) errors.telegram = 'Telegram debe tener @ y entre 5 y 32 caracteres.';
    if (form.whatsapp && form.whatsapp.length !== 9) errors.whatsapp = 'Si ingresas WhatsApp, debe tener 9 numeros despues de +51.';
    if (!receiptData) errors.receipt = 'Adjunta la captura del comprobante de pago.';
    if (!form.terminos) errors.terminos = 'Debes aceptar los terminos y condiciones.';
    return errors;
  }, [form, receiptData]);

  const showError = (key: keyof PurchaseForm | 'receipt') => (submitAttempted || touched[key]) ? validationErrors[key] || '' : '';

  const getValidationMessage = (requireReceipt = true) => {
    const entries = Object.entries(validationErrors);
    const first = entries.find(([key]) => requireReceipt || key !== 'receipt');
    if (first) return first[1] || '';
    return '';
  };

  const canSubmit = useMemo(
    () => !getValidationMessage(true) && !submitting,
    [validationErrors, submitting]
  );

  useEffect(() => {
    let active = true;
    setPaymentConfigLoading(true);
    setQrLoading(true);
    setQrLoadFailed(false);
    getPurchaseConfig().then((response) => {
      if (!active) return;
      if (!response.success) {
        setPaymentConfigLoading(false);
        setQrLoading(false);
        setQrLoadFailed(true);
        return;
      }
      const data = response.data || {};
      setPaymentConfig((prev) => {
        return {
          yapeQrUrl: data.yapeQrUrl ? normalizeQrImageUrl(String(data.yapeQrUrl)) : prev.yapeQrUrl,
          paymentAmount: data.paymentAmount ? String(data.paymentAmount) : prev.paymentAmount,
          paymentReceiver: data.paymentReceiver ? String(data.paymentReceiver) : prev.paymentReceiver,
        };
      });
      setPaymentConfigLoading(false);
    }).catch(() => {
      if (!active) return;
      setPaymentConfigLoading(false);
      setQrLoading(false);
      setQrLoadFailed(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!paymentConfig.yapeQrUrl) {
      setQrLoadFailed(false);
      if (!paymentConfigLoading) setQrLoading(false);
      return;
    }
    setQrLoading(true);
    setQrLoadFailed(false);
  }, [paymentConfig.yapeQrUrl]);

  const rememberPurchase = (next: PurchaseCache) => {
    setPurchaseCache(next);
    window.localStorage.setItem(PURCHASE_CACHE_KEY, JSON.stringify(next));
  };

  const sameCachedPurchase =
    purchaseCache &&
    ((form.dni.trim() && purchaseCache.dni === form.dni.trim()) ||
      (form.usuario.trim() && purchaseCache.usuario === form.usuario.trim()));

  const handleCheckStatus = async (override?: { dni?: string; usuario?: string }) => {
    const dni = override?.dni || form.dni.trim() || purchaseCache?.dni || '';
    const usuario = override?.usuario || form.usuario.trim() || purchaseCache?.usuario || '';
    if (!dni && !usuario) {
      setMessage({ type: 'error', text: 'Ingresa tu DNI o usuario para consultar el estado.' });
      return;
    }

    setCheckingStatus(true);
    setMessage(null);
    const response = await checkPurchaseStatus({ varDNI: dni, varUsuario: usuario });
    setCheckingStatus(false);

    if (!response.success) {
      setMessage({ type: 'error', text: response.message || 'No se pudo consultar el estado de la compra.' });
      return;
    }

    const data = response.data || {};
    rememberPurchase({
      dni: data.dni || dni,
      usuario: data.username || usuario,
      estado: data.estado || '',
      active: data.active === true,
      pending: data.pending === true,
      message: response.message,
      savedAt: new Date().toISOString(),
    });
    setMessage({ type: data.active ? 'success' : 'success', text: response.message || 'Estado consultado correctamente.' });
  };

  const handleReceipt = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Selecciona una imagen del comprobante de pago.' });
      return;
    }
    try {
      const compressed = await compressImageFile(file);
      setReceiptData(compressed);
      setReceiptName(file.name);
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo procesar el comprobante.' });
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitAttempted(true);
    setTouched((prev) => ({
      ...prev,
      ...Object.fromEntries(requiredTouchedFields.map((key) => [key, true])),
      receipt: true,
      terminos: true,
    }));
    if (sameCachedPurchase && purchaseCache?.pending !== false && purchaseCache?.active !== true) {
      await handleCheckStatus({ dni: purchaseCache.dni, usuario: purchaseCache.usuario });
      return;
    }
    if (!canSubmit) {
      setMessage({ type: 'error', text: getValidationMessage(true) || 'Completa los datos obligatorios.' });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const response = await submitPurchaseRequest({
      varNombres: form.nombres.trim(),
      varDNI: form.dni,
      varLugar: form.lugar.trim(),
      varIE: form.ie.trim(),
      varEspecialidad: form.especialidad.trim(),
      varUsuario: form.usuario,
      varContrasena: form.contrasena,
      varGmail: form.gmail.trim(),
      varOutlook: form.outlook.trim(),
      varTelegram: form.telegram,
      varWhatsApp: form.whatsapp ? `+51${form.whatsapp}` : '',
      imageBase64: receiptData,
      varTerminos: form.terminos,
      deviceContext: {
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userAgent: navigator.userAgent,
      },
    });
    setSubmitting(false);

    if (!response.success) {
      setMessage({ type: 'error', text: response.message || 'La compra no se ha podido registrar. Intentalo nuevamente en un minuto.' });
      return;
    }

    setMessage({
      type: 'success',
      text: response.message || 'Compra registrada. Revisaremos tu comprobante y activaremos tu acceso.',
    });
    rememberPurchase({
      dni: response.data?.dni || form.dni.trim(),
      usuario: response.data?.username || form.usuario.trim(),
      estado: response.data?.estado || 'Pendiente',
      active: response.data?.active === true,
      pending: response.data?.pending !== false,
      message: response.message,
      savedAt: new Date().toISOString(),
    });
    setForm(initialForm);
    setReceiptData('');
    setReceiptName('');
    setTouched({});
    setSubmitAttempted(false);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-transparent text-slate-800">
      <div className="relative flex min-h-screen items-center justify-center px-4 py-8">
        <div className="absolute left-4 top-8 hidden w-[29vw] max-w-[330px] min-w-[220px] rotate-[-4deg] md:block">
          <div className="rounded-[2rem] border-4 border-slate-950/10 bg-white/85 p-7 shadow-2xl">
            <img src={logoBar} alt="ARMI" className="mx-auto h-28 w-28 rounded-full object-contain" />
            <div className="mt-5 rounded-2xl bg-cyan-500 px-5 py-4 text-center text-white shadow-lg">
              <p className="text-[11px] font-black uppercase tracking-[0.18em]">ARMI Docente</p>
              <p className="mt-1 text-sm font-bold">Completa tu compra y activa tu acceso.</p>
            </div>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="purchase-shell relative z-10 w-full max-w-[670px] px-6 pb-7 pt-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)] md:px-14"
        >
          <button
            type="button"
            onClick={onBack}
            className="absolute right-9 top-6 flex h-11 w-11 items-center justify-center rounded-full text-4xl font-black text-slate-900 transition hover:-translate-x-1"
            title="Volver al login"
          >
            ‹
          </button>

          <div className="text-center">
            <img src={armarIcon} alt="ARMAR" className="mx-auto h-9 w-9 rounded-full object-contain" />
            <h1 className="mt-1 font-serif text-[2rem] italic leading-none text-cyan-500">Formulario de compra</h1>
            <p className="mx-auto mt-3 max-w-[520px] text-[12px] font-semibold italic leading-relaxed text-slate-700">
              Ingresa tus datos y adjunta la captura del comprobante de pago. Tu solicitud sera procesada en un plazo no mayor a 24 horas.
            </p>
          </div>

          <fieldset className="mt-5 rounded-md border-2 border-cyan-400 px-5 pb-5 pt-3">
            <legend className="px-3 text-[13px] font-black text-slate-500">Datos de docente:</legend>
            <Field label="Apellidos y nombres" value={form.nombres} onChange={(value) => update('nombres', value)} onBlur={() => markTouched('nombres')} error={showError('nombres')} />
            <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-[0.8fr_1.2fr]">
              <Field
                label="DNI"
                value={form.dni}
                onChange={(value) => update('dni', onlyDigits(value, 8))}
                onBlur={() => markTouched('dni')}
                error={showError('dni')}
                inputMode="numeric"
                maxLength={8}
                autoComplete="off"
              />
              <Field label="Lugar donde trabaja" value={form.lugar} onChange={(value) => update('lugar', value)} />
            </div>
            <Field className="mt-2" label="I.E. donde labora" value={form.ie} onChange={(value) => update('ie', value)} onBlur={() => markTouched('ie')} error={showError('ie')} />
            <Field className="mt-2" label="Especialidad" value={form.especialidad} onChange={(value) => update('especialidad', value)} />
            <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Usuario (crea uno)"
                value={form.usuario}
                onChange={(value) => update('usuario', normalizeUsername(value))}
                onBlur={() => markTouched('usuario')}
                error={showError('usuario')}
                maxLength={24}
                autoComplete="username"
              />
              <label className="block">
                <span className="mb-1 block text-[11px] font-black text-slate-500">Contrasena (crea una)</span>
                <div className="flex h-8 overflow-hidden rounded-full border border-slate-300 bg-white/80 text-[13px] font-semibold text-slate-800 transition focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-100">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.contrasena}
                    onChange={(event) => update('contrasena', event.target.value.slice(0, 32))}
                    onBlur={() => markTouched('contrasena')}
                    maxLength={32}
                    autoComplete="new-password"
                    aria-invalid={!!showError('contrasena')}
                    className="min-w-0 flex-1 bg-transparent px-4 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="flex h-full w-10 items-center justify-center text-slate-500 transition hover:bg-slate-100 hover:text-cyan-600"
                    title={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                    aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M2.3 3.7 3.7 2.3l18 18-1.4 1.4-3.1-3.1A10.6 10.6 0 0 1 12 20C6.8 20 3.1 16.9 1 12c.8-1.9 2-3.5 3.4-4.8L2.3 3.7Zm6.2 6.2A3.8 3.8 0 0 0 12 16a3.8 3.8 0 0 0 2.1-.6l-1.6-1.6a1.9 1.9 0 0 1-2.3-2.3L8.5 9.9ZM12 4c5.2 0 8.9 3.1 11 8a14.2 14.2 0 0 1-3.1 4.5l-3-3A4.8 4.8 0 0 0 10.5 7l-2-2A10.5 10.5 0 0 1 12 4Z"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M12 4c5.2 0 8.9 3.1 11 8-2.1 4.9-5.8 8-11 8S3.1 16.9 1 12c2.1-4.9 5.8-8 11-8Zm0 2C8 6 5.1 8.1 3.2 12 5.1 15.9 8 18 12 18s6.9-2.1 8.8-6C18.9 8.1 16 6 12 6Zm0 2.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
                {showError('contrasena') ? <p className="mt-1 animate-pulse text-[10px] font-black text-red-600">{showError('contrasena')}</p> : null}
              </label>
            </div>
          </fieldset>

          <fieldset className="mt-5 rounded-md border-2 border-cyan-400 px-5 pb-5 pt-3">
            <legend className="px-3 text-[13px] font-black text-slate-500">Tus datos de contacto:</legend>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_178px]">
              <div className="space-y-2">
                <Field label="Gmail" value={form.gmail} onChange={(value) => update('gmail', normalizeEmail(value))} onBlur={() => markTouched('gmail')} error={showError('gmail')} type="email" autoComplete="email" />
                <Field label="Outlook (puede ser hotmail u otro)" value={form.outlook} onChange={(value) => update('outlook', normalizeEmail(value))} onBlur={() => markTouched('outlook')} error={showError('outlook')} type="email" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Telegram (@usuario)" value={form.telegram} onChange={(value) => update('telegram', normalizeTelegram(value))} onBlur={() => markTouched('telegram')} error={showError('telegram')} maxLength={33} />
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-black text-slate-500">WhatsApp</span>
                    <div className="flex h-8 overflow-hidden rounded-full border border-slate-300 bg-white/80 text-[13px] font-semibold text-slate-800 transition focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-100">
                      <span className="flex items-center border-r border-slate-200 bg-slate-100 px-3 text-slate-600">+51</span>
                      <input
                        value={form.whatsapp}
                        onChange={(event) => update('whatsapp', onlyDigits(event.target.value, 9))}
                        onBlur={() => markTouched('whatsapp')}
                        inputMode="numeric"
                        maxLength={9}
                        autoComplete="tel-national"
                        aria-invalid={!!showError('whatsapp')}
                        className="min-w-0 flex-1 bg-transparent px-3 outline-none"
                      />
                    </div>
                    {showError('whatsapp') ? <p className="mt-1 animate-pulse text-[10px] font-black text-red-600">{showError('whatsapp')}</p> : null}
                  </label>
                </div>
              </div>

              <div className="flex h-[276px] flex-col items-center justify-between gap-2 rounded-2xl bg-slate-50/80 p-2">
                <div className="flex h-[154px] w-[154px] flex-col items-center justify-center overflow-hidden rounded-[1.2rem] bg-[#7b239f] p-2 text-center text-white shadow-xl">
                  {paymentConfigLoading || paymentConfig.yapeQrUrl ? (
                    <div className="relative h-[112px] w-[112px] rounded-lg bg-white p-1">
                      {paymentConfigLoading || qrLoading ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-white text-[#7b239f]">
                          <span className="h-7 w-7 animate-spin rounded-full border-4 border-[#7b239f]/20 border-t-[#7b239f]" />
                          <span className="text-[9px] font-black">Cargando QR</span>
                        </div>
                      ) : null}
                      {qrLoadFailed ? (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white px-2 text-[9px] font-black leading-tight text-[#7b239f]">
                          No se pudo cargar el QR
                        </div>
                      ) : null}
                      {paymentConfig.yapeQrUrl ? (
                        <img
                          src={paymentConfig.yapeQrUrl}
                          alt="QR de pago Yape"
                          onLoad={() => {
                            setQrLoading(false);
                            setQrLoadFailed(false);
                          }}
                          onError={() => {
                            setQrLoading(false);
                            setQrLoadFailed(true);
                          }}
                          className={`h-full w-full rounded-md object-contain transition-opacity ${paymentConfigLoading || qrLoading || qrLoadFailed ? 'opacity-0' : 'opacity-100'}`}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex h-[112px] w-[112px] items-center justify-center rounded-lg bg-white/95 px-2 text-[10px] font-black text-[#7b239f]">
                      QR Yape no configurado
                    </div>
                  )}
                  <p className="mt-1 text-[11px] font-black">Pago S/. {paymentConfig.paymentAmount}</p>
                  <p className="text-[10px] font-black leading-tight">{paymentConfig.paymentReceiver}</p>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void handleReceipt(event)} />
                <button
                  type="button"
                  onClick={() => {
                    markTouched('receipt');
                    fileInputRef.current?.click();
                  }}
                  className="group flex h-[106px] w-full flex-col justify-between rounded-xl border-2 border-dashed border-cyan-300 bg-cyan-50 p-2 text-center transition hover:border-cyan-500 hover:bg-cyan-100"
                  title={receiptData ? 'Cambiar boucher' : 'Subir boucher'}
                >
                  <div className="h-[70px] w-full overflow-hidden rounded-lg bg-white/80">
                    {receiptData ? (
                      <img src={receiptData} alt="Vista previa del boucher" className="h-full w-full object-cover transition group-hover:scale-105" />
                    ) : (
                      <span className="flex h-full items-center justify-center px-2 text-[11px] font-black text-cyan-700">Subir boucher</span>
                    )}
                  </div>
                  <span className="truncate text-[10px] font-black text-cyan-800">{receiptName || 'Comprobante pendiente'}</span>
                </button>
                {showError('receipt') ? <p className="animate-pulse text-center text-[10px] font-black text-red-600">{showError('receipt')}</p> : null}
              </div>
            </div>
          </fieldset>

          <p className="mt-3 text-center text-[12px] font-semibold leading-snug text-slate-700">
            Si tienes problemas con tu pago o prefieres otro metodo, contacta directamente al desarrollador usando los botones inferiores.
          </p>

          <label className="mt-4 flex items-center justify-center gap-2 text-[12px] font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={form.terminos}
              onChange={(event) => update('terminos', event.target.checked)}
              onBlur={() => markTouched('terminos')}
              className="h-4 w-4"
            />
            <span>Acepto terminos y condiciones.</span>
          </label>
          {showError('terminos') ? <p className="mt-1 animate-pulse text-center text-[10px] font-black text-red-600">{showError('terminos')}</p> : null}

          {message ? (
            <div className={`mt-4 rounded-xl px-4 py-3 text-center text-sm font-bold ${message.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {message.text}
            </div>
          ) : null}

          {purchaseCache ? (
            <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-center text-sm font-semibold text-cyan-800">
              <p>
                Solicitud registrada para <span className="font-black">{purchaseCache.usuario || purchaseCache.dni}</span>
                {purchaseCache.estado ? ` · Estado: ${purchaseCache.estado}` : ''}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCheckStatus({ dni: purchaseCache.dni, usuario: purchaseCache.usuario })}
                  disabled={checkingStatus}
                  className="rounded-full bg-cyan-600 px-4 py-2 text-xs font-black uppercase tracking-[0.08em] text-white disabled:opacity-50"
                >
                  {checkingStatus ? 'Consultando...' : 'Consultar estado'}
                </button>
                {purchaseCache.active ? (
                  <button
                    type="button"
                    onClick={onBack}
                    className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-[0.08em] text-white"
                  >
                    Ir al login
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={(!canSubmit && !sameCachedPurchase) || submitting || checkingStatus}
            className="mx-auto mt-5 flex h-12 w-full max-w-[290px] items-center justify-center rounded-full bg-cyan-500 text-[15px] font-black uppercase tracking-[0.18em] text-white shadow-[0_8px_0_#0786a5] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Enviando...' : sameCachedPurchase && purchaseCache?.active !== true ? 'Consultar compra' : 'Comprar'}
          </button>

          <div className="mt-5 flex justify-center gap-5">
            <ContactButton label="WA" href="https://wa.me/+51910354300" tone="bg-emerald-500" />
            <ContactButton label="TG" href="https://t.me/armar369" tone="bg-sky-500" />
            <ContactButton label="MS" href="https://m.me/arnold.9339" tone="bg-violet-600" />
          </div>
        </form>
      </div>
    </div>
  );
};
