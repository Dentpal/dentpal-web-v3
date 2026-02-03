import React, { useEffect, useMemo, useRef, useState } from 'react';
import ProfileUpload from './ProfileUpload';
import { useAuth } from '@/hooks/use-auth';
import { Pencil, Save, X, Loader2, Upload, Paperclip, CheckCircle2, AlertCircle } from 'lucide-react';
import Tesseract from 'tesseract.js';
import SellersService from '@/services/sellers';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useProfileCompletion } from '@/hooks/useProfileCompletion';

// Add known tax type catalog for matching from 2303 text
const TAX_TYPE_CATALOG = [
	'INCOME TAX',
	'VALUE-ADDED TAX',
	'VAT',
	'PERCENTAGE TAX',
	'WITHHOLDING TAX',
	'WITHHOLDING TAX - EXPANDED',
	'WITHHOLDING TAX - COMPENSATION',
	'EXCISE TAX',
	'OTHER PERCENTAGE TAX',
];

/**
 * SellerProfileTab
 * Streamlined seller profile tab focused on Vendor Enrollment.
 */
const SellerProfileTab: React.FC = () => {
		// Modal state for profile image upload
		const [profileUploadOpen, setProfileUploadOpen] = useState(false);
		// Modal state for cover image upload
		const [coverUploadOpen, setCoverUploadOpen] = useState(false);

		// Handler for image upload (profile)
		const handleProfileImageUpload = () => {
			setProfileUploadOpen(false);
			// Optionally, show a success message or refresh state
		};

		// Handler for image upload (cover)
		const handleCoverImageUpload = () => {
			setCoverUploadOpen(false);
			// Optionally, show a success message or refresh state
		};
	const { uid } = useAuth();
	const { vendorProfileComplete } = useProfileCompletion();
	const [isEditing, setIsEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [submitLoading, setSubmitLoading] = useState(false);

	// Only keep Vendor Enrollment state
	// Use the same category set as Inventory/Add Product
	const CATEGORY_OPTIONS = ['Consumables', 'Dental Equipment', 'Disposables', 'Equipment'];
	const [vendor, setVendor] = useState({
		categories: [] as string[],
		companyName: '',
		storeName: '',
		address: { street: '', barangay: '', municipality: '', province: '', zip: '' }, // split address
		contactPerson: '',
		landline: '',
		mobile: '',
		email: '',
		website: '',
		tin: '',
		// Newly captured fields from 2303
		rdoCode: '',
		taxTypes: [] as string[],
		lineOfBusiness: '',
		dateOfRegistration: '', // YYYY-MM-DD
		bankingInfo: '',
		bankBranchAddress: '',
		merchantAgreement: null as File | null,
		requirements: {
			secOrDti: null as File | null,
			bir2303: null as File | null,
			fdaLto: null as File | null,
			catalogue: null as File | null,
			warrantyPolicy: null as File | null,
		},
	});

	// Prefill vendor form from Firestore (Seller.vendor) if available
	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				if (!uid) return;
				const doc = await SellersService.get(uid);
				if (!mounted) return;
				
				const v: any = (doc as any)?.vendor || null;
				if (!v) {
					return;
				}				
				setVendor(prev => ({
					...prev,
					categories: Array.isArray(v.categories) ? v.categories : [],
					companyName: v.company?.name || '',
					storeName: v.company?.storeName || '',
					address: {
						street: v.company?.address?.line1 || '',
						barangay: v.company?.address?.line2 || '',
						municipality: v.company?.address?.city || '',
						province: v.company?.address?.province || '',
						zip: v.company?.address?.zip || '',
					},
					contactPerson: v.contacts?.name || '',
					mobile: v.contacts?.phone || '',
					email: v.contacts?.email || '',
					website: v.website || '',
					tin: v.tin || '',
					rdoCode: v.rdoCode || '',
					taxTypes: Array.isArray(v.taxTypes) ? v.taxTypes : [],
					lineOfBusiness: v.lineOfBusiness || '',
					dateOfRegistration: v.dateOfRegistration || '',
					bankingInfo: v.bankingInfo || '',
					bankBranchAddress: v.bankBranchAddress || '',
				}));
			} catch (err) {
				console.error('Error loading vendor profile:', err);
			}
		})();
		return () => { mounted = false; };
	}, [uid]);

	// Validation state
	const [errors, setErrors] = useState<{ mobile: string; email: string; tin: string; tinOcr: string; zip?: string; regDate?: string }>({ mobile: '', email: '', tin: '', tinOcr: '' });
	const [mapOpen, setMapOpen] = useState(false);
	// NEW: Review dialog state
	const [reviewOpen, setReviewOpen] = useState(false);
	// NEW: Success & Error dialogs
	const [successOpen, setSuccessOpen] = useState(false);
	const [errorOpen, setErrorOpen] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string>('');

	// Suggestion/extraction state
	type Suggestions = {
		textSource: 'pdf-text' | 'ocr-image' | 'ocr-pdf-render' | 'unknown';
		values: Partial<{
			tin: string;
			companyName: string;
			address: string;
			rdoCode: string;
			taxTypes: string[];
			lineOfBusiness: string;
			dateOfRegistration: string;
		}>;
		confidence: Partial<Record<'tin' | 'companyName' | 'address' | 'rdoCode' | 'taxTypes' | 'lineOfBusiness' | 'dateOfRegistration', number>>;
	};
	const [extractionLoading, setExtractionLoading] = useState(false);
	const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
	const [suggestionsOpen, setSuggestionsOpen] = useState(false);
	const [userConfirmed, setUserConfirmed] = useState(false);
	// Wizard steps
	const STEPS = ['Upload & Review', 'Company & Address', 'Contacts & Documents'];
	const [step, setStep] = useState(0);

	// Refs for jump-to-edit UX
	const tinInputRef = useRef<HTMLInputElement>(null);
	const companyNameRef = useRef<HTMLInputElement>(null);
	const storeNameRef = useRef<HTMLInputElement>(null);
	const contactPersonRef = useRef<HTMLInputElement>(null);
	const streetRef = useRef<HTMLInputElement>(null);
	const provinceRef = useRef<HTMLSelectElement>(null);
	const cityRef = useRef<HTMLSelectElement>(null);
	const barangayRef = useRef<HTMLSelectElement>(null);
	const zipRef = useRef<HTMLInputElement>(null);
	const mobileRef = useRef<HTMLInputElement>(null);
	const emailRef = useRef<HTMLInputElement>(null);
	const websiteRef = useRef<HTMLInputElement>(null);
	const bankingRef = useRef<HTMLTextAreaElement>(null);
	const bankBranchRef = useRef<HTMLInputElement>(null);

	// TIN helpers
	const normalizeTin = (v: string) => v.replace(/\D/g, '').slice(0, 12);
	const formatTin = (digits: string) => {
		const d = digits.replace(/\D/g, '');
		if (d.length <= 3) return d;
		if (d.length <= 6) return `${d.slice(0,3)}-${d.slice(3)}`;
		if (d.length <= 9) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
		return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6,9)}-${d.slice(9,12)}`;
	};
	const validateTin = (digits: string) => (/^\d{9}(\d{3})?$/.test(digits) ? '' : 'Enter 9 digits or 12 digits (with branch code).');

	// Mobile/Email helpers
	const validateMobile = (val: string) => (/^09\d{9}$/.test(val) ? '' : 'Must start with 09 and be 11 digits.');
	const validateEmail = (val: string) => (val.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? '' : 'Invalid email address.');
	const formatMobile = (digits: string) => {
		const d = digits.slice(0, 11);
		if (!d) return '';
		if (d.length <= 4) return d;
		if (d.length <= 7) return `${d.slice(0,4)} ${d.slice(4)}`;
		return `${d.slice(0,4)} ${d.slice(4,7)} ${d.slice(7)}`;
	};
	const validateZip = (val: string) => (val && !/^\d{4}$/.test(val) ? 'ZIP must be 4 digits.' : '');
	const validateRegDate = (val: string) => {
		if (!val) return '';
		// Expect YYYY-MM-DD from <input type="date">
		return /^\d{4}-\d{2}-\d{2}$/.test(val) ? '' : 'Invalid date format (YYYY-MM-DD).';
	};

	const onMobileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
		setField('mobile', digits);
		setErrors((prev) => ({ ...prev, mobile: digits ? validateMobile(digits) : '' }));
	};
	const onEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const v = e.target.value;
		setField('email', v);
		setErrors((prev) => ({ ...prev, email: v ? validateEmail(v) : '' }));
	};

	// TIN masked input change
	const onTinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const digits = normalizeTin(e.target.value);
		setField('tin', digits);
		setErrors((prev) => ({ ...prev, tin: digits ? validateTin(digits) : '' }));
	};

	// OCR compare when 2303 is uploaded
	const [ocrLoading, setOcrLoading] = useState(false);
	const runTinOcrCheck = async (file: File) => {
		setOcrLoading(true);
		try {
			const { data } = await Tesseract.recognize(file, 'eng', { logger: () => {} });
			const text = (data.text || '').replace(/\s+/g, ' ').toUpperCase();
			// Extract TIN-like patterns
			const matches = text.match(/\b\d{3}[-\s]?\d{3}[-\s]?\d{3}(?:[-\s]?\d{3})?\b/g) || [];
			const normalized = matches.map(m => m.replace(/\D/g, ''));
			const unique = Array.from(new Set(normalized));
			const inputTin = vendor.tin; // digits only stored
			const ok = unique.some(t => t === inputTin || (t.length === 12 && inputTin.length === 9 && t.startsWith(inputTin)));
			setErrors(prev => ({ ...prev, tinOcr: ok ? '' : unique.length ? 'TIN in 2303 does not match the entered TIN.' : 'Could not detect a TIN in the uploaded 2303.' }));
		} catch (e) {
			setErrors(prev => ({ ...prev, tinOcr: 'OCR failed. Please ensure the document is clear.' }));
		} finally {
			setOcrLoading(false);
		}
	};

	// Address helpers
	const setAddressField = (k: keyof typeof vendor.address, val: string) => setVendor(v => ({ ...v, address: { ...v.address, [k]: val } }));
	const onZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const digits = e.target.value.replace(/\D/g, '').slice(0, 4); // PH ZIP is 4 digits
		setAddressField('zip', digits);
		setErrors(prev => ({ ...prev, zip: validateZip(digits) }));
	};
	const fullAddress = useMemo(() => {
		const { street, barangay, municipality, province, zip } = vendor.address;
		return [street, barangay, municipality, province, zip ? `\u200E${zip}` : '']
			.filter(Boolean)
			.join(', ');
	}, [vendor.address]);

	// Only treat these as blocking errors; OCR mismatch and registration date are warnings
	const blockingErrors = !!(errors.mobile || errors.email || errors.tin || errors.zip);
	const addressReady = !!(vendor.address.street && vendor.address.municipality && vendor.address.province);

	// Per-step validation gating
	const canProceed = useMemo(() => {
		switch (step) {
			case 0:
				// Must have uploaded 2303, extraction finished, user confirmed review, and TIN format has no error (OCR/date are warnings)
				return !!vendor.requirements.bir2303 && !extractionLoading && !!userConfirmed && !errors.tin;
			case 1:
				return addressReady && !errors.zip;
			case 2:
				return !blockingErrors && !!vendor.requirements.bir2303 && !!userConfirmed;
			default:
				return true;
		}
	}, [step, vendor, extractionLoading, userConfirmed, errors.tin, errors.zip, addressReady, blockingErrors]);
	const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
	const back = () => setStep(s => Math.max(s - 1, 0));

	const Title = useMemo(() => (
		<div className="flex items-center justify-between">
			<h2 className="text-base font-semibold text-gray-900">Vendor Enrollment</h2>
			<div className="flex items-center gap-2">
				{!isEditing ? (
					<button onClick={() => setIsEditing(true)} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50">
						<Pencil className="w-4 h-4" /> Edit
					</button>
				) : (
					<>
						<button onClick={() => setIsEditing(false)} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50">
							<X className="w-4 h-4" /> Cancel
						</button>
						<button
							disabled={saving}
							onClick={async () => {
								setSaving(true);
								try {
									// TODO: save draft to backend
									await new Promise(r => setTimeout(r, 800));
									setIsEditing(false);
								} finally { setSaving(false); }
							}}
							className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
						>
							{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
						</button>
					</>
				)}
			</div>
		</div>
	), [isEditing, saving]);

	// Completed summary view (read-only)
	const renderCompletedSummary = () => (
		<div className="space-y-4">
			<div className="bg-white rounded-lg border border-gray-200 p-4">
				<div className="flex items-center justify-between">
					<div className="text-sm font-semibold text-gray-900">Vendor Profile</div>
					<span className="inline-flex items-center text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded">Completed</span>
				</div>
				<div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
					<div>
						<div className="text-gray-500 text-xs">Company</div>
						<div className="text-gray-900">{vendor.companyName || '-'}</div>
					</div>
					<div>
						<div className="text-gray-500 text-xs">Store</div>
						<div className="text-gray-900">{vendor.storeName || '-'}</div>
					</div>
					<div className="md:col-span-2">
						<div className="text-gray-500 text-xs">Address</div>
						<div className="text-gray-900">{fullAddress || '-'}</div>
					</div>
					<div>
						<div className="text-gray-500 text-xs">Contact</div>
						<div className="text-gray-900">{vendor.contactPerson || '-'} • {vendor.mobile || vendor.landline || '-'}</div>
					</div>
					<div>
						<div className="text-gray-500 text-xs">Email</div>
						<div className="text-gray-900">{vendor.email || '-'}</div>
					</div>
					<div>
						<div className="text-gray-500 text-xs">Website</div>
						<div className="text-gray-900">{vendor.website || '-'}</div>
					</div>
					<div>
						<div className="text-gray-500 text-xs">TIN</div>
						<div className="text-gray-900">{formatTin(vendor.tin) || '-'}</div>
					</div>
					<div>
						<div className="text-gray-500 text-xs">RDO Code</div>
						<div className="text-gray-900">{vendor.rdoCode || '-'}</div>
					</div>
					<div className="md:col-span-2">
						<div className="text-gray-500 text-xs">Tax Types</div>
						<div className="text-gray-900">{(vendor.taxTypes || []).join(', ') || '-'}</div>
					</div>
				</div>
				{/* Action buttons below profile info */}
				<div className="mt-6 flex gap-3">
					<button
						className="px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700 transition"
						onClick={() => setProfileUploadOpen(true)}
					>
						Submit Profile
					</button>
					<button
						className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
						onClick={() => setCoverUploadOpen(true)}
					>
						Submit Cover Image
					</button>
				</div>
				{/* ProfileUpload modals */}
				<ProfileUpload
					open={profileUploadOpen}
					onClose={() => setProfileUploadOpen(false)}
					onUpload={handleProfileImageUpload}
					title="Upload Profile Image"
				/>
				<ProfileUpload
					open={coverUploadOpen}
					onClose={() => setCoverUploadOpen(false)}
					onUpload={handleCoverImageUpload}
					title="Upload Cover Image"
				/>
			</div>
		</div>
	);

	// Helpers
	const toggleCategory = (cat: string) => {
		setVendor(v => ({ ...v, categories: v.categories.includes(cat) ? v.categories.filter(c => c !== cat) : [...v.categories, cat] }));
	};
	const setField = (k: keyof typeof vendor, val: any) => setVendor(v => ({ ...v, [k]: val }));
	const setReqFile = (k: keyof typeof vendor.requirements, file: File | null) => {
		setVendor(v => ({ ...v, requirements: { ...v.requirements, [k]: file } }));
		if (k === 'bir2303' && file) {
			// Run OCR check in background
			runTinOcrCheck(file);
			// Extract and prefill fields
			extractFrom2303(file);
			setUserConfirmed(false);
		}
	};

	// NEW: jump-to-edit UX helper
	const jumpAndFocus = (targetStep: number, ref?: React.RefObject<HTMLElement>, extra?: () => void) => {
		setReviewOpen(false);
		setIsEditing(true);
		if (targetStep === 0) setSuggestionsOpen(true);
		setStep(targetStep);
		// Wait for UI to update
		setTimeout(() => {
			if (extra) extra();
			ref?.current?.focus();
		}, 60);
	};

	// Extraction: PDF text -> parse; if not possible, render first page and OCR; also OCR images
	const readFileAsArrayBuffer = (file: File) => new Promise<ArrayBuffer>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as ArrayBuffer); fr.onerror = rej; fr.readAsArrayBuffer(file); });
	const canvasFromPdfFirstPage = async (data: ArrayBuffer) => {
		const pdfjsLib: any = await import('pdfjs-dist');
		const task = pdfjsLib.getDocument({ data, disableWorker: true });
		const pdf = await task.promise;
		const page = await pdf.getPage(1);
		const viewport = page.getViewport({ scale: 2 });
		const canvas = document.createElement('canvas');
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		const ctx = canvas.getContext('2d')!;
		await page.render({ canvasContext: ctx, viewport }).promise;
		return canvas;
	};
	const extractPdfText = async (data: ArrayBuffer) => {
		try {
			const pdfjsLib: any = await import('pdfjs-dist');
			const task = pdfjsLib.getDocument({ data, disableWorker: true });
			const pdf = await task.promise;
			let text = '';
			const pageCount = Math.min(pdf.numPages, 2); // first 2 pages are enough
			for (let i = 1; i <= pageCount; i++) {
				const page = await pdf.getPage(i);
				const tc = await page.getTextContent();
				text += ' ' + tc.items.map((it: any) => (it.str || '')).join(' ');
			}
			return text;
		} catch {
			return '';
		}
	};
	const parse2303Text = (raw: string): Suggestions => {
		const text = (raw || '').replace(/\s+/g, ' ').toUpperCase();
		const out: Suggestions = { textSource: 'unknown', values: {}, confidence: {} };
		// TIN
		const tinMatch = text.match(/\b\d{3}-?\d{3}-?\d{3}(?:-?\d{3})?\b/);
		if (tinMatch) {
			const tinDigits = tinMatch[0].replace(/\D/g, '');
			out.values.tin = tinDigits;
			out.confidence.tin = tinDigits.length === 12 || tinDigits.length === 9 ? 0.95 : 0.7;
		}
		// Company Name (Registered/Trade Name)
		let company = '';
		const regIdx = text.indexOf('REGISTERED NAME');
		if (regIdx >= 0) {
			company = text.slice(regIdx + 'REGISTERED NAME'.length).split(/\s{2,}|\n|ADDRESS|TRADE NAME|RDO CODE/)[0].trim();
		}
		if (!company) {
			const tradeIdx = text.indexOf('TRADE NAME');
			if (tradeIdx >= 0) company = text.slice(tradeIdx + 'TRADE NAME'.length).split(/\s{2,}|\n|ADDRESS|RDO CODE/)[0].trim();
		}
		if (company) { out.values.companyName = company; out.confidence.companyName = 0.7; }
		// Address
		let addr = '';
		const addrIdx = text.indexOf('REGISTERED ADDRESS');
		if (addrIdx >= 0) addr = text.slice(addrIdx + 'REGISTERED ADDRESS'.length).split(/\s{2,}|\n|RDO CODE|LINE OF BUSINESS|DATE OF REGISTRATION/)[0].trim();
		if (addr) { out.values.address = addr; out.confidence.address = 0.65; }
		// RDO Code
		const rdo = text.match(/RDO\s*CODE\s*[:\-]?\s*(\d{2,3})/);
		if (rdo) { out.values.rdoCode = rdo[1]; out.confidence.rdoCode = 0.9; }
		// Line of Business
		const lob = text.match(/LINE OF BUSINESS\s*[:\-]?\s*([^\n]+)/);
		if (lob) { out.values.lineOfBusiness = lob[1].trim(); out.confidence.lineOfBusiness = 0.75; }
		// Date of Registration
		const dor = text.match(/(DATE OF REGISTRATION|REGISTRATION DATE)\s*[:\-]?\s*([A-Z0-9/\- ,]+)/);
		if (dor) {
			const rawDate = dor[2].trim();
			// Try to normalize common formats MM/DD/YYYY or DD/MM/YYYY to YYYY-MM-DD conservatively
			let iso = '';
			const m1 = rawDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
			if (m1) {
				const mm = m1[1].padStart(2,'0'); const dd = m1[2].padStart(2,'0'); const yyyy = m1[3];
				iso = `${yyyy}-${mm}-${dd}`;
			}
			const m2 = rawDate.match(/(\d{4})-(\d{2})-(\d{2})/);
			if (!iso && m2) iso = m2[0];
			out.values.dateOfRegistration = iso || rawDate; // if cannot normalize, keep as-is
			out.confidence.dateOfRegistration = iso ? 0.9 : 0.6;
		}
		// Tax types list heuristics
		const foundTaxTypes = Array.from(new Set(TAX_TYPE_CATALOG.filter(tt => text.includes(tt))));
		if (foundTaxTypes.length) {
			// Normalize VAT alias
			const norm = Array.from(new Set(foundTaxTypes.map(t => (t === 'VAT' ? 'VALUE-ADDED TAX' : t))));
			out.values.taxTypes = norm;
			out.confidence.taxTypes = 0.6;
		}
		return out;
	};
	const applyAddressSplit = (rawAddress?: string) => {
		if (!rawAddress) return;
		// Very light heuristic: pick ZIP as last 4 digits, rest as street line, user edits municipality/province manually
		const zipMatch = rawAddress.match(/(\d{4})(?!.*\d)/);
		const zip = zipMatch ? zipMatch[1] : '';
		const street = rawAddress.replace(/,?\s*\d{4}(?!.*\d)/, '').trim();
		setVendor(v => ({
			...v,
			address: { ...v.address, street, zip: zip || v.address.zip },
		}));
		setErrors(prev => ({ ...prev, zip: validateZip(zip || '') }));
	};
	const extractFrom2303 = async (file: File) => {
		setExtractionLoading(true);
		try {
			let text = '';
			let source: Suggestions['textSource'] = 'unknown';
			if (/pdf/i.test(file.type) || file.name.toLowerCase().endsWith('.pdf')) {
				const data = await readFileAsArrayBuffer(file);
				text = await extractPdfText(data);
				if (text && text.trim().length > 20) {
					source = 'pdf-text';
				} else {
					// Render first page then OCR
					const canvas = await canvasFromPdfFirstPage(data);
					const dataUrl = canvas.toDataURL('image/png');
					const { data: ocr } = await Tesseract.recognize(dataUrl, 'eng', { logger: () => {} });
					text = ocr.text || '';
					source = 'ocr-pdf-render';
				}
			} else {
				const { data: ocr } = await Tesseract.recognize(file, 'eng', { logger: () => {} });
				text = ocr.text || '';
				source = 'ocr-image';
			}
			const sug = parse2303Text(text);
			sug.textSource = source;
			setSuggestions(sug);
			setSuggestionsOpen(true);
			// Prefill vendor from suggestions
			setVendor(v => ({
				...v,
				tin: sug.values.tin ? sug.values.tin : v.tin,
				companyName: sug.values.companyName || v.companyName,
				rdoCode: sug.values.rdoCode || v.rdoCode,
				taxTypes: sug.values.taxTypes || v.taxTypes,
				lineOfBusiness: sug.values.lineOfBusiness || v.lineOfBusiness,
				dateOfRegistration: sug.values.dateOfRegistration || v.dateOfRegistration,
			}));
			applyAddressSplit(sug.values.address);
			// Validate new fields
			setErrors(prev => ({ ...prev, regDate: validateRegDate(sug.values.dateOfRegistration || '') }));
		} catch (e) {
			// no-op, suggestions remain null
		} finally {
			setExtractionLoading(false);
		}
	};

	const formattedMobile = useMemo(() => formatMobile(vendor.mobile), [vendor.mobile]);
	const formattedTin = useMemo(() => formatTin(vendor.tin), [vendor.tin]);

	// Provinces, cities, barangays
	const [regions, setRegions] = useState<Array<{ code: string; name: string }>>([]);
	const [allProvinces, setAllProvinces] = useState<Array<{ code: string; name: string }>>([]);
	const [provinces, setProvinces] = useState<Array<{ code: string; name: string }>>([]);
	const [cities, setCities] = useState<Array<{ code: string; name: string }>>([]);
	const [barangays, setBarangays] = useState<Array<{ code: string; name: string }>>([]);
	// Selected codes for cascading selects
	const [selectedRegion, setSelectedRegion] = useState('');
	const [selectedProvince, setSelectedProvince] = useState('');
	const [selectedCity, setSelectedCity] = useState('');
	const [selectedBarangay, setSelectedBarangay] = useState('');
	// ZIP auto-fill loading
	const [zipLoading, setZipLoading] = useState(false);

	// Helper to safely access CJS/ESM exports from select-philippines-address
	const getAddressApi = async () => {
		const mod: any = await import('select-philippines-address');
		const api = {
			regions: mod.regions || mod.default?.regions,
			provinces: mod.provinces || mod.default?.provinces,
			cities: mod.cities || mod.default?.cities,
			barangays: mod.barangays || mod.default?.barangays,
		};
		if (!api.regions || !api.provinces || !api.cities || !api.barangays) {
			throw new Error('select-philippines-address API not available');
		}
		return api as {
			regions: () => Promise<any[]>;
			provinces: (regionCode: string) => Promise<any[]>;
			cities: (provinceCode: string) => Promise<any[]>;
			barangays: (cityCode: string) => Promise<any[]>;
		};
	};

	useEffect(() => {
		(async () => {
			try {
				const api = await getAddressApi();
				const regionList = await api.regions();
				const regionsMapped = regionList.map((r: any) => ({ code: r.region_code ?? r.code, name: r.region_name ?? r.name }));
				setRegions(regionsMapped);
				// Preload all provinces across all regions so Province select is usable without region
				const provinceGroups = await Promise.all(
					regionsMapped.map(async (r) => {
						try {
							const list = await api.provinces(r.code);
							return list.map((p: any) => ({ code: p.province_code ?? p.code, name: p.province_name ?? p.name }));
						} catch (err) {
							console.error('Failed loading provinces for region', r.code, err);
							return [] as Array<{ code: string; name: string }>;
						}
					})
				);
				setAllProvinces(provinceGroups.flat());
			} catch (err) {
				console.error('Failed loading regions/provinces', err);
				setRegions([]);
				setAllProvinces([]);
			}
		})();
	}, []);

	// Auto-fill ZIP using Nominatim based on current address parts
	const autoFillZipFromNames = async (municipalityName: string, provinceName: string, barangayName?: string) => {
		if (!municipalityName || !provinceName) return;
		try {
			setZipLoading(true);
			const q = [barangayName, municipalityName, provinceName, 'Philippines'].filter(Boolean).join(', ');
			const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=ph&q=${encodeURIComponent(q)}`;
			const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
			if (!res.ok) throw new Error('ZIP lookup failed');
			const data: any[] = await res.json();
			const postcode = data?.[0]?.address?.postcode || '';
			if (postcode) {
				setVendor(prev => {
					// Only auto-fill if empty to avoid overriding manual input
					if (prev.address.zip) return prev;
					return { ...prev, address: { ...prev.address, zip: postcode } };
				});
				setErrors(prev => ({ ...prev, zip: validateZip(postcode) }));
			}
		} catch (e) {
			// Silent fail; user can enter ZIP manually
		} finally {
			setZipLoading(false);
		}
	};

	const onRegionSelect = async (code: string) => {
		setSelectedRegion(code);
		setSelectedProvince(''); setSelectedCity(''); setSelectedBarangay('');
		setVendor(v => ({ ...v, address: { ...v.address, province: '', municipality: '', barangay: '' } }));
		setProvinces([]); setCities([]); setBarangays([]);
		if (!code) return;
		try {
			const api = await getAddressApi();
			const list = await api.provinces(code);
			setProvinces(list.map((p: any) => ({ code: p.province_code ?? p.code, name: p.province_name ?? p.name })));
		} catch (err) {
			console.error('Failed loading provinces for region', code, err);
		}
	};
	const onProvinceSelect = async (code: string) => {
		setSelectedProvince(code);
		const currentProvinces = selectedRegion ? provinces : allProvinces;
		const name = currentProvinces.find(p=>p.code===code)?.name || '';
		setVendor(v => ({ ...v, address: { ...v.address, province: name, municipality: '', barangay: '', zip: '' } }));
		setSelectedCity(''); setSelectedBarangay('');
		setCities([]); setBarangays([]);
		if (!code) return;
		try {
			const api = await getAddressApi();
			const list = await api.cities(code);
			setCities(list.map((c: any) => ({ code: c.city_code ?? c.municipality_code ?? c.code, name: c.city_name ?? c.municipality_name ?? c.name })));
		} catch (err) {
			console.error('Failed loading cities for province', code, err);
		}
	};
	const onCitySelect = async (code: string) => {
		setSelectedCity(code);
		const name = cities.find(c=>c.code===code)?.name || '';
		setVendor(v => ({ ...v, address: { ...v.address, municipality: name, barangay: '', zip: '' } }));
		setSelectedBarangay('');
		setBarangays([]);
		if (!code) return;
		try {
			const api = await getAddressApi();
			const list = await api.barangays(code);
			setBarangays(list.map((b: any) => ({ code: b.brgy_code ?? b.barangay_code ?? b.code, name: b.brgy_name ?? b.barangay_name ?? b.name })));
		} catch (err) {
			console.error('Failed loading barangays for city', code, err);
		}
		// Attempt to auto-fill ZIP using current names
		const provinceNameCurrent = vendor.address.province;
		autoFillZipFromNames(name, provinceNameCurrent);
	};
	const onBarangaySelect = (code: string) => {
		setSelectedBarangay(code);
		const name = barangays.find(b=>b.code===code)?.name || '';
		setVendor(v => ({ ...v, address: { ...v.address, barangay: name, zip: '' } }));
		// Refine ZIP with barangay if available
		autoFillZipFromNames(vendor.address.municipality, vendor.address.province, name);
	};

	// NEW: Extracted submit logic to reuse from review dialog
	const submitEnrollment = async () => {
		setSubmitLoading(true);
		try {
			if (!uid) { throw new Error('Not signed in'); }
			// 1) Upload documents to Storage (SellerImages/<uid>/...)
			let birUpload: { url: string; path: string } | null = null;
			if (vendor.requirements.bir2303) {
				birUpload = await SellersService.uploadImage(uid, vendor.requirements.bir2303, 'SellerImages');
			}
			const docFiles: Record<string, File | null> = {
				secOrDti: vendor.requirements.secOrDti,
				fdaLto: vendor.requirements.fdaLto,
				catalogue: vendor.requirements.catalogue,
				warrantyPolicy: vendor.requirements.warrantyPolicy,
			};
			const documents: Record<string, { url: string; path: string }> = {};
			await Promise.all(Object.entries(docFiles).map(async ([k, file]) => {
				if (file) {
					documents[k] = await SellersService.uploadImage(uid, file, 'SellerImages');
				}
			}));

			// 2) Build vendor payload and persist to Firestore (Seller collection)
			const payload: any = {
				categories: vendor.categories,
				company: { name: vendor.companyName, storeName: vendor.storeName, address: { line1: vendor.address.street, line2: '', city: vendor.address.municipality, province: vendor.address.province, zip: vendor.address.zip } },
				contacts: { name: vendor.contactPerson, email: vendor.email, phone: vendor.mobile },
				// 2303-derived
				tin: vendor.tin,
				rdoCode: vendor.rdoCode,
				taxTypes: vendor.taxTypes,
				lineOfBusiness: vendor.lineOfBusiness,
				dateOfRegistration: vendor.dateOfRegistration,
				// Other details
				website: vendor.website,
				bankingInfo: vendor.bankingInfo,
				bankBranchAddress: vendor.bankBranchAddress,
				bir: birUpload,
				documents,
				requirements: {
					secOrDti: !!documents.secOrDti,
					fdaLto: !!documents.fdaLto,
					catalogue: !!documents.catalogue,
					warrantyPolicy: !!documents.warrantyPolicy,
					birSubmitted: !!birUpload,
					profileCompleted: true,
				},
			};
			await SellersService.saveVendorProfile(uid, payload);
			setReviewOpen(false);
			setIsEditing(false);
			setSuccessOpen(true);
			// Notify app to refresh permission/profile gating
			try { window.dispatchEvent(new CustomEvent('dentpal:refresh-profile')); } catch {}
		} catch (e: any) {
			setErrorMsg(e?.message || 'Submission failed. Please try again.');
			setErrorOpen(true);
		} finally { setSubmitLoading(false); }
	};

	// Check if we have vendor data even if not marked as complete
	const hasVendorData = !!(vendor.companyName || vendor.tin || vendor.email || vendor.mobile);

	return (
		<div className="space-y-6">
			{Title}

			{/* Show completed summary if profile is complete OR if vendor data exists */}
			{(vendorProfileComplete || hasVendorData) && !isEditing ? (
				<>
					{!vendorProfileComplete && hasVendorData && (
						<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
							<p className="text-sm text-amber-800">
								Your profile information is available but not marked as complete. You can view your details below or click Edit to update.
							</p>
						</div>
					)}
					{renderCompletedSummary()}
				</>
			) : (
				<>
					{/* Stepper Header and wizard shown only when not completed or when editing */}
					<div className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-gray-100 px-3 py-2 rounded-t-lg">
						<ol className="flex items-center gap-2 overflow-x-auto">
							{STEPS.map((label, i) => (
								<li key={label} className={`flex items-center gap-2 text-xs whitespace-nowrap ${i === step ? 'text-teal-700 font-medium' : i < step ? 'text-teal-600' : 'text-gray-500'}`}>
									<span className={`h-5 w-5 inline-flex items-center justify-center rounded-full border ${i <= step ? 'border-teal-600 bg-teal-50' : 'border-gray-300'}`}>{i + 1}</span>
									<button type="button" className="hover:underline" onClick={() => i <= step && setStep(i)}>{label}</button>
									{i < STEPS.length - 1 && <span className="w-6 h-px bg-gray-200" />}
								</li>
							))}
						</ol>
					</div>

					{/* Step 1: Upload & Review 2303 */}
					<div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
						{step === 0 && (
							<>
								<div className="flex items-center justify-between">
									<div>
										<div className="text-sm font-medium text-gray-900">Step 1: Upload & Review BIR 2303</div>
										<p className="text-xs text-gray-600">Upload a PDF or image. We will auto-extract your details for review.</p>
									</div>
									<div className="flex items-center gap-3">
										<input
											type="file"
											accept="application/pdf,image/*"
											disabled={!isEditing}
											onChange={(e) => setReqFile('bir2303', e.target.files?.[0] || null)}
										/>
										{extractionLoading && <span className="text-xs text-gray-500 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/> Extracting…</span>}
										{vendor.requirements.bir2303 && !extractionLoading && (
											<span className="text-xs text-gray-700 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-teal-600"/> {vendor.requirements.bir2303.name}</span>
										)}
									</div>
								</div>

								{/* Review suggestions (merged into Step 1) */}
								{suggestions && (
									<div className="mt-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
										<div className="flex items-center justify-between">
											<div className="text-sm font-medium text-gray-900">Review extracted details</div>
											<button type="button" className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-white" onClick={()=> setSuggestionsOpen(s=>!s)}>{suggestionsOpen ? 'Hide' : 'Show'}</button>
										</div>
										{suggestionsOpen && (
											<div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
												{/* TIN */}
												<div>
													<label className="block text-xs font-medium text-gray-600 mb-1">TIN (from 2303) <span className="ml-1 text-[10px] text-gray-500">{Math.round((suggestions.confidence.tin||0)*100)}%</span></label>
													<input ref={tinInputRef} disabled={!isEditing} value={formattedTin} onChange={onTinChange} inputMode="numeric" className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
												</div>
												{/* Company Name */}
												<div>
													<label className="block text-xs font-medium text-gray-600 mb-1">Registered/Trade Name <span className="ml-1 text-[10px] text-gray-500">{Math.round((suggestions.confidence.companyName||0)*100)}%</span></label>
													<input ref={companyNameRef} disabled={!isEditing} value={vendor.companyName} onChange={(e)=> setField('companyName', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
												</div>
												{/* Address quick fill */}
												<div className="md:col-span-2">
													<label className="block text-xs font-medium text-gray-600 mb-1">Address (split) <span className="ml-1 text-[10px] text-gray-500">{Math.round((suggestions.confidence.address||0)*100)}%</span></label>
													<div className="grid grid-cols-1 md:grid-cols-5 gap-2">
														<input disabled={!isEditing} placeholder="Street" value={vendor.address.street} onChange={(e)=> setAddressField('street', e.target.value)} className="md:col-span-2 w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
														<input disabled={!isEditing} placeholder="Barangay" value={vendor.address.barangay} onChange={(e)=> setAddressField('barangay', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
														<input disabled={!isEditing} placeholder="Municipality/City" value={vendor.address.municipality} onChange={(e)=> setAddressField('municipality', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
														<input disabled={!isEditing} placeholder="Province" value={vendor.address.province} onChange={(e)=> setAddressField('province', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
														<input disabled={!isEditing} placeholder="ZIP" value={vendor.address.zip} onChange={onZipChange} inputMode="numeric" maxLength={4} className={`w-full text-sm p-2 border rounded-lg disabled:bg-gray-50 ${errors.zip ? 'border-red-300' : 'border-gray-200'}`} />
													</div>
													{errors.zip && <p className="mt-1 text-xs text-red-600">{errors.zip}</p>}
												</div>
												{/* RDO Code */}
												<div>
													<label className="block text-xs font-medium text-gray-600 mb-1">RDO Code <span className="ml-1 text-[10px] text-gray-500">{Math.round((suggestions.confidence.rdoCode||0)*100)}%</span></label>
													<input disabled={!isEditing} value={vendor.rdoCode} onChange={(e)=> setField('rdoCode', e.target.value.replace(/\D/g,''))} inputMode="numeric" className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
												</div>
												{/* Line of Business */}
												<div>
													<label className="block text-xs font-medium text-gray-600 mb-1">Line of Business <span className="ml-1 text-[10px] text-gray-500">{Math.round((suggestions.confidence.lineOfBusiness||0)*100)}%</span></label>
													<input disabled={!isEditing} value={vendor.lineOfBusiness} onChange={(e)=> setField('lineOfBusiness', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
												</div>
												{/* Date of Registration */}
												<div>
													<label className="block text-xs font-medium text-gray-600 mb-1">Date of Registration <span className="ml-1 text-[10px] text-gray-500">{Math.round((suggestions.confidence.dateOfRegistration||0)*100)}%</span></label>
													<input disabled={!isEditing} type="date" value={/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(vendor.dateOfRegistration) ? vendor.dateOfRegistration : ''} onChange={(e)=> { setField('dateOfRegistration', e.target.value); setErrors(prev=>({ ...prev, regDate: validateRegDate(e.target.value) })); }} className={`w-full text-sm p-2 border rounded-lg disabled:bg-gray-50 ${errors.regDate ? 'border-red-300' : 'border-gray-200'}`} />
													{/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(vendor.dateOfRegistration) ? null : (vendor.dateOfRegistration && (
														<p className="mt-1 text-xs text-amber-700">Unrecognized date format from document: {vendor.dateOfRegistration}. Please correct.</p>
													))}
													{errors.regDate && <p className="mt-1 text-xs text-red-600">{errors.regDate}</p>}
												</div>
												{/* Tax Types */}
												<div className="md:col-span-2">
													<label className="block text-xs font-medium text-gray-600 mb-1">Tax Types <span className="ml-1 text-[10px] text-gray-500">{Math.round((suggestions.confidence.taxTypes||0)*100)}%</span></label>
													<div className="flex flex-wrap gap-2">
														{Array.from(new Set([...(suggestions.values.taxTypes || []), ...vendor.taxTypes, ...TAX_TYPE_CATALOG]))
															.filter(t => t && t !== 'VAT')
															.slice(0, 12)
															.map(t => (
																<label key={t} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border ${vendor.taxTypes.includes(t) ? 'bg-teal-50 border-teal-300' : 'border-gray-200'}`}>
																	<input type="checkbox" disabled={!isEditing} checked={vendor.taxTypes.includes(t)} onChange={() => setVendor(v => ({ ...v, taxTypes: v.taxTypes.includes(t) ? v.taxTypes.filter(x => x !== t) : [...v.taxTypes, t] }))} className="h-3 w-3" />
																	<span className="text-[11px] text-gray-800">{t}</span>
																</label>
															))}
													</div>
												</div>

												<div className="md:col-span-2 flex items-center justify-between mt-1">
													<div className="text-[11px] text-gray-500">Source: {suggestions.textSource.replace('-', ' ')}</div>
													<label className="inline-flex items-center gap-2 text-xs text-gray-700">
														<input type="checkbox" className="h-4 w-4" checked={userConfirmed} onChange={(e)=> setUserConfirmed(e.target.checked)} />
														<span>I confirm the extracted details are correct.</span>
													</label>
												</div>
											</div>
										)}
									</div>
								)}
							</>
						)}
					</div>

					{/* Steps 2–3 Form Sections */}
					{step >= 1 && (
						<div className="bg-white rounded-lg border border-gray-200 p-4 space-y-5">
							{/* Step 2 (index 1): Categories + Company & Address */}
							{step === 1 && (
								<>
									{/* Categories */}
									<div>
										<div className="text-xs font-medium text-gray-600 mb-1">Product Category</div>
										<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
											{CATEGORY_OPTIONS.map(cat => (
												<label key={cat} className={`flex items-center gap-2 p-2 rounded-lg border ${vendor.categories.includes(cat) ? 'border-teal-300 bg-teal-50' : 'border-gray-200'}`}>
													<input
														type="checkbox"
														disabled={!isEditing}
														checked={vendor.categories.includes(cat)}
														onChange={() => toggleCategory(cat)}
														className="h-4 w-4 text-teal-600 rounded border-gray-300 focus:ring-teal-500 disabled:opacity-50"
													/>
													<span className="text-sm text-gray-800">{cat}</span>
												</label>
											))}
										</div>
									</div>

									{/* Company Info & Address */}
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Company Name</label>
											<input ref={companyNameRef} disabled={!isEditing} value={vendor.companyName} onChange={(e)=> setField('companyName', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Store Name</label>
											<input ref={storeNameRef} disabled={!isEditing} value={vendor.storeName} onChange={(e)=> setField('storeName', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Customer Service Contact Person</label>
											<input ref={contactPersonRef} disabled={!isEditing} value={vendor.contactPerson} onChange={(e)=> setField('contactPerson', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
										<div className="md:col-span-2">
											<label className="block text-xs font-medium text-gray-600 mb-1">Street</label>
											<input ref={streetRef} disabled={!isEditing} value={vendor.address.street} onChange={(e)=> setAddressField('street', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Region</label>
											<select disabled={!isEditing} value={selectedRegion} onChange={(e)=> onRegionSelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50">
												<option value="">Select region</option>
												{regions.map(r => (<option key={r.code} value={r.code}>{r.name}</option>))}
											</select>
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Province</label>
											<select ref={provinceRef} disabled={!isEditing} value={selectedProvince} onChange={(e)=> onProvinceSelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50">
												<option value="">Select province</option>
												{(selectedRegion ? provinces : allProvinces).map(p => (<option key={p.code} value={p.code}>{p.name}</option>))}
											</select>
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Municipality / City</label>
											<select ref={cityRef} disabled={!isEditing || !selectedProvince} value={selectedCity} onChange={(e)=> onCitySelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50">
												<option value="">Select city/municipality</option>
												{cities.map(c => (<option key={c.code} value={c.code}>{c.name}</option>))}
											</select>
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Barangay</label>
											<select ref={barangayRef} disabled={!isEditing || !selectedCity} value={selectedBarangay} onChange={(e)=> onBarangaySelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50">
												<option value="">Select barangay</option>
												{barangays.map(b => (<option key={b.code} value={b.code}>{b.name}</option>))}
											</select>
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">ZIP Code</label>
											<input ref={zipRef} disabled={!isEditing} value={vendor.address.zip} onChange={onZipChange} inputMode="numeric" maxLength={4} placeholder="e.g. 1000" className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
											{zipLoading && <p className="mt-1 text-xs text-gray-500">Auto-filling ZIP…</p>}
											{errors.zip && <p className="mt-1 text-xs text-red-600">{errors.zip}</p>}
										</div>
										<div className="md:col-span-2 flex items-center gap-2">
											<button
												type="button"
												disabled={!isEditing || !addressReady}
												onClick={() => setMapOpen(true)}
												className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
											>
												Verify on map
											</button>
											{addressReady ? (
												<a
													className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50"
													href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}
													target="_blank"
													rel="noreferrer"
												>
													View in Google Maps
												</a>
											) : (
												<button
													type="button"
													disabled
													className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 disabled:opacity-40"
												>
													View in Google Maps
												</button>
											)}
											<span className="text-xs text-gray-500">We will open a map with the entered address for quick verification.</span>
										</div>
									</div>
								</>
							)}

							{/* Step 3 (index 2): Contacts & Documents */}
							{step === 2 && (
								<>
									{/* Contacts */}
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Landline No</label>
											<input disabled={!isEditing} value={vendor.landline} onChange={(e)=> setField('landline', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Mobile No</label>
											<input
												ref={mobileRef}
												disabled={!isEditing}
												value={formattedMobile}
												onChange={onMobileChange}
												inputMode="numeric"
												maxLength={13}
												placeholder="0912 345 6789"
												aria-invalid={!!errors.mobile}
												className={`w-full text-sm p-2 border rounded-lg disabled:bg-gray-50 ${errors.mobile ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 'border-gray-200'}`}
											/>
											{errors.mobile && <p className="mt-1 text-xs text-red-600">{errors.mobile}</p>}
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Email Address</label>
											<input
												ref={emailRef}
												disabled={!isEditing}
												type="email"
												value={vendor.email}
												onChange={onEmailChange}
												placeholder="name@example.com"
												aria-invalid={!!errors.email}
												className={`w-full text-sm p-2 border rounded-lg disabled:bg-gray-50 ${errors.email ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 'border-gray-200'}`}
											/>
											{errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Website</label>
											<input ref={websiteRef} disabled={!isEditing} value={vendor.website} onChange={(e)=> setField('website', e.target.value)} placeholder="https://" className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
									</div>

									{/* Documents & Banking */}
									<div className="grid grid-cols-1 gap-4 mt-4">
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Payment / Banking Information</label>
											<textarea ref={bankingRef} disabled={!isEditing} rows={3} value={vendor.bankingInfo} onChange={(e)=> setField('bankingInfo', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" placeholder="Bank name, account name/number" />
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Bank Branch Address</label>
											<input ref={bankBranchRef} disabled={!isEditing} value={vendor.bankBranchAddress} onChange={(e)=> setField('bankBranchAddress', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
									</div>

									<div>
										<label className="block text-xs font-medium text-gray-600 mb-2">Requirements</label>
										<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
											{[
												{ key: 'secOrDti', label: 'SEC Certificate or DTI Registration' },
												{ key: 'fdaLto', label: 'FDA LTO Medical Device' },
												{ key: 'catalogue', label: 'Catalogue / Product Lists' },
												{ key: 'warrantyPolicy', label: 'Warranty / After Sales Policy' },
											].map(({ key, label }) => (
												<div key={key} className="p-3 border border-gray-200 rounded-lg">
													<div className="text-xs text-gray-700 mb-2">{label}</div>
													<div className="flex items-center justify-between gap-2">
														<input disabled={!isEditing} type="file" accept="application/pdf,image/*" onChange={(e)=> setReqFile(key as any, e.target.files?.[0] || null)} />
														<div className="text-[11px] text-gray-600 inline-flex items-center gap-1">
															{(vendor.requirements as any)[key] ? <><CheckCircle2 className="w-3 h-3 text-teal-600" /> Uploaded</> : <><AlertCircle className="w-3 h-3 text-amber-600" /> Required</>}
														</div>
													</div>
												</div>
											))}
										</div>
									</div>
								</>
							)}
						</div>
					)}

					{/* Sticky Footer Nav */}
					<div className="sticky bottom-0 bg-white/80 backdrop-blur border-t border-gray-200 px-4 py-3 flex items-center justify-between rounded-b-lg">
						<span className="text-xs text-gray-600">Step {step + 1} of {STEPS.length}</span>
						<div className="flex items-center gap-2">
							<button type="button" onClick={back} disabled={step === 0} className="px-3 py-2 text-xs rounded-lg border border-gray-200 disabled:opacity-40">Back</button>
							{step < STEPS.length - 1 ? (
								<button type="button" onClick={next} disabled={!canProceed} className="px-3 py-2 text-xs rounded-lg bg-teal-600 text-white disabled:opacity-40">Next</button>
							) : (
								<button
									disabled={!canProceed || submitLoading}
									onClick={() => setReviewOpen(true)}
									className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
								>
									{submitLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Review & Submit
								</button>
							)}
						</div>
					</div>

					{/* NEW: Review dialog for final confirmation */}
					<Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
						<DialogContent className="w-[95vw] sm:max-w-3xl lg:max-w-4xl max-h-[85vh] p-0 overflow-hidden flex flex-col">
							<DialogHeader className="px-6 pt-5 pb-3 border-b">
								<DialogTitle>Review your enrollment</DialogTitle>
								<DialogDescription>Confirm your details. Click Edit to jump to a field.</DialogDescription>
							</DialogHeader>
							{/* Scrollable content area */}
							<div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
								{/* Company & Tax */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
									<div className="p-3 border border-gray-200 rounded-lg">
										<div className="text-xs text-gray-500">TIN</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm font-medium text-gray-900">{formattedTin || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(0, tinInputRef as any, () => setSuggestionsOpen(true))}>Edit</button>
										</div>
										{errors.tinOcr && <p className="mt-1 text-xs text-amber-700">Warning: {errors.tinOcr}</p>}
									</div>
									<div className="p-3 border border-gray-200 rounded-lg">
										<div className="text-xs text-gray-500">RDO Code</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm font-medium text-gray-900">{vendor.rdoCode || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(0)}>Edit</button>
										</div>
									</div>
									<div className="p-3 border border-gray-200 rounded-lg md:col-span-2">
										<div className="text-xs text-gray-500">Tax Types</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm text-gray-900">{vendor.taxTypes?.length ? vendor.taxTypes.join(', ') : '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(0)}>Edit</button>
										</div>
									</div>
								</div>

								{/* Company & Address */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
									<div className="p-3 border border-gray-200 rounded-lg">
										<div className="text-xs text-gray-500">Company Name</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm font-medium text-gray-900">{vendor.companyName || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(1, companyNameRef as any)}>Edit</button>
										</div>
									</div>
									<div className="p-3 border border-gray-200 rounded-lg">
										<div className="text-xs text-gray-500">Store Name</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm font-medium text-gray-900">{vendor.storeName || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(1, storeNameRef as any)}>Edit</button>
										</div>
									</div>
									<div className="p-3 border border-gray-200 rounded-lg md:col-span-2">
										<div className="text-xs text-gray-500">Address</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm text-gray-900">{fullAddress || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(1, streetRef as any)}>Edit</button>
										</div>
									</div>
									<div className="p-3 border border-gray-200 rounded-lg md:col-span-2">
										<div className="text-xs text-gray-500">Categories</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm text-gray-900">{vendor.categories?.length ? vendor.categories.join(', ') : '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(1)}>Edit</button>
										</div>
									</div>
								</div>

								{/* Contacts & Banking */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
									<div className="p-3 border border-gray-200 rounded-lg">
										<div className="text-xs text-gray-500">Contact Person</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm font-medium text-gray-900">{vendor.contactPerson || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(1, contactPersonRef as any)}>Edit</button>
										</div>
									</div>
									<div className="p-3 border border-gray-200 rounded-lg">
										<div className="text-xs text-gray-500">Mobile</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm font-medium text-gray-900">{formattedMobile || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(2, mobileRef as any)}>Edit</button>
										</div>
										{errors.mobile && <p className="mt-1 text-xs text-red-600">{errors.mobile}</p>}
									</div>
									<div className="p-3 border border-gray-200 rounded-lg">
										<div className="text-xs text-gray-500">Email</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm font-medium text-gray-900">{vendor.email || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(2, emailRef as any)}>Edit</button>
										</div>
										{errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
									</div>
										<div className="text-xs text-gray-500">Website</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm font-medium text-gray-900">{vendor.website || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(2, websiteRef as any)}>Edit</button>
										</div>
									</div>
									<div className="p-3 border border-gray-200 rounded-lg md:col-span-2">
										<div className="text-xs text-gray-500">Banking Information</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm text-gray-900 whitespace-pre-wrap">{vendor.bankingInfo || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(2, bankingRef as any)}>Edit</button>
										</div>
									</div>
									<div className="p-3 border border-gray-200 rounded-lg md:col-span-2">
										<div className="text-xs text-gray-500">Bank Branch Address</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm font-medium text-gray-900">{vendor.bankBranchAddress || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(2, bankBranchRef as any)}>Edit</button>
										</div>
									</div>
								</div>

								{/* Documents */}
								<div className="p-3 border border-gray-200 rounded-lg">
									<div className="text-xs text-gray-500 mb-2">Documents</div>
									<ul className="text-sm text-gray-900 space-y-1">
										<li className="flex items-center justify-between"><span>BIR 2303</span><span className="text-gray-700">{vendor.requirements.bir2303 ? (vendor.requirements.bir2303 as File).name : '—'}</span></li>
										<li className="flex items-center justify-between"><span>SEC/DTI</span><span className="text-gray-700">{vendor.requirements.secOrDti ? (vendor.requirements.secOrDti as File).name : '—'}</span></li>
										<li className="flex items-center justify-between"><span>FDA LTO</span><span className="text-gray-700">{vendor.requirements.fdaLto ? (vendor.requirements.fdaLto as File).name : '—'}</span></li>
										<li className="flex items-center justify-between"><span>Catalogue</span><span className="text-gray-700">{vendor.requirements.catalogue ? (vendor.requirements.catalogue as File).name : '—'}</span></li>
										<li className="flex items-center justify-between"><span>Warranty Policy</span><span className="text-gray-700">{vendor.requirements.warrantyPolicy ? (vendor.requirements.warrantyPolicy as File).name : '—'}</span></li>
									</ul>
									<div className="mt-2"><button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(2)}>Edit documents</button></div>
								</div>
							<DialogFooter className="px-6 py-4 border-t">
							<button className="px-3 py-2 text-xs rounded-lg border border-gray-200" onClick={() => setReviewOpen(false)}>Back to edit</button>
							<button
								disabled={submitLoading}
								onClick={submitEnrollment}
								className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
							>
								{submitLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Confirm & Submit
							</button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

					{/* Success Dialog */}
					<Dialog open={successOpen} onOpenChange={(o)=>{ setSuccessOpen(o); if(!o){ window.location.reload(); } }}>
						<DialogContent className="w-[90vw] sm:max-w-md p-0 overflow-hidden">
							<div className="p-6 text-center space-y-3">
								<CheckCircle2 className="mx-auto h-10 w-10 text-teal-600" />
								<DialogTitle className="text-base">Enrollment submitted</DialogTitle>
								<DialogDescription>Your documents were uploaded and your profile is now under review. Seller tools are now unlocked.</DialogDescription>
								<div className="pt-2 flex items-center justify-center gap-2">
									<button className="px-3 py-2 text-xs rounded-lg border border-gray-200" onClick={()=>{ setSuccessOpen(false); }}>Close</button>
									<button className="px-3 py-2 text-xs rounded-lg bg-teal-600 text-white" onClick={()=>{ setSuccessOpen(false); }}>Go to Dashboard</button>
								</div>
							</div>
						</DialogContent>
					</Dialog>
					{/* Error Dialog */}
					<Dialog open={errorOpen} onOpenChange={setErrorOpen}>
						<DialogContent className="w-[90vw] sm:max-w-md">
							<DialogHeader>
								<DialogTitle>Submission failed</DialogTitle>
								<DialogDescription>{errorMsg}</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<button className="px-3 py-2 text-xs rounded-lg border border-gray-200" onClick={()=> setErrorOpen(false)}>Close</button>
							</DialogFooter>
						</DialogContent>
					</Dialog>

					{mapOpen && (
						<div className="fixed inset-0 z-50 flex items-center justify-center">
							<div className="absolute inset-0 bg-black/40" onClick={() => setMapOpen(false)} />
							<div className="relative z-10 w-[95vw] max-w-3xl bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
								<div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
									<div>
										<div className="text-xs text-gray-500">Verify Address</div>
										<div className="text-sm font-medium text-gray-900 truncate">{fullAddress || '—'}</div>
									</div>
									<button className="text-xs px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50" onClick={() => setMapOpen(false)}>Close</button>
								</div>
								<div className="aspect-video w-full">
									<iframe
										title="Map"
										width="100%"
										height="100%"
										style={{ border: 0 }}
									
										loading="lazy"
										allowFullScreen
										src={`https://www.google.com/maps?q=${encodeURIComponent(fullAddress)}&output=embed`}
									/>
								</div>
								<div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
									<a
										className="text-xs text-teal-700 hover:underline"
										href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}
										target="_blank"
										rel="noreferrer"
									>
										Open in Google Maps
									</a>
									<button className="text-xs px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50" onClick={() => setMapOpen(false)}>Done</button>
								</div>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}

export default SellerProfileTab;
