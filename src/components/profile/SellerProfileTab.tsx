import React, { useEffect, useMemo, useRef, useState } from 'react';
import ProfileUpload from './ProfileUpload';
import { useAuth } from '@/hooks/use-auth';
import { Pencil, Save, X, Loader2, Upload, Paperclip, CheckCircle2, AlertCircle } from 'lucide-react';
import Tesseract from 'tesseract.js';
import SellersService from '@/services/sellers';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
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

type LocationGroup = '' | 'NCR' | 'Luzon' | 'Visayas' | 'Mindanao';

const regionToLocation = (name: string): LocationGroup => {
	const n = (name || '').toUpperCase();
	if (n.includes('NCR') || n.includes('NATIONAL CAPITAL')) return 'NCR';
	if (/(ILOCOS|CAGAYAN|CENTRAL LUZON|CALABARZON|MIMAROPA|BICOL|CORDILLERA|CAR)/.test(n)) return 'Luzon';
	if (/(WESTERN VISAYAS|CENTRAL VISAYAS|EASTERN VISAYAS|NEGROS ISLAND)/.test(n)) return 'Visayas';
	if (/(ZAMBOANGA|NORTHERN MINDANAO|DAVAO|SOCCSKSARGEN|CARAGA|BARMM|BANGSAMORO|AUTONOMOUS REGION IN MUSLIM)/.test(n)) return 'Mindanao';
	return '';
};

/**
 * SellerProfileTab
 * Streamlined seller profile tab focused on Vendor Enrollment.
 */
const SellerProfileTab: React.FC = () => {
		// Modal state for profile image upload
		const [profileUploadOpen, setProfileUploadOpen] = useState(false);
		// Modal state for cover image upload
		const [coverUploadOpen, setCoverUploadOpen] = useState(false);
		// Walkthrough/Welcome state
		const [showWelcome, setShowWelcome] = useState(false);
	// Success dialog state
	const [showSuccessDialog, setShowSuccessDialog] = useState(false);
	// Image URLs state
	const [profileImageUrl, setProfileImageUrl] = useState<string>('');
	const [coverImageUrl, setCoverImageUrl] = useState<string>('');

	// Handler for image upload (profile)
	const handleProfileImageUpload = async () => {
		setProfileUploadOpen(false);
		// Refresh the vendor data to get the new image URL
		if (uid) {
			try {
				const doc = await SellersService.get(uid);
				const v: any = (doc as any)?.vendor || null;
				if (v?.profileImage?.url) {
					setProfileImageUrl(v.profileImage.url);
					setShowSuccessDialog(true);
				}
			} catch (error) {
				console.error('Error loading profile image:', error);
				// Consider showing an error toast/alert to the user
			}
		}
	};

	// Handler for image upload (cover)
	const handleCoverImageUpload = async () => {
		setCoverUploadOpen(false);
		// Refresh the vendor data to get the new image URL
		if (uid) {
			try {
				const doc = await SellersService.get(uid);
				const v: any = (doc as any)?.vendor || null;
				if (v?.coverImage?.url) {
					setCoverImageUrl(v.coverImage.url);
					setShowSuccessDialog(true);
				}
			} catch (error) {
				console.error('Error loading cover image:', error);
				// Consider showing an error toast/alert to the user
			}
		}
	};
	const { uid } = useAuth();
	const { vendorProfileComplete } = useProfileCompletion();
	// Start in view mode by default - will be adjusted based on vendor data
	const [isEditing, setIsEditing] = useState(false);
	
	// Check if this is first visit (show welcome) - check on mount and when profile status changes
	useEffect(() => {
		const hasSeenWelcome = localStorage.getItem('dentpal_vendor_welcome_seen');
		// Show welcome if profile is incomplete AND either haven't seen it OR it's been cleared
		if (!vendorProfileComplete && !hasSeenWelcome) {
			setShowWelcome(true);
		}
	}, [vendorProfileComplete]);
	const [saving, setSaving] = useState(false);
	const [submitLoading, setSubmitLoading] = useState(false);

	// Section-specific editing states
	const [editingBIR, setEditingBIR] = useState(false);
	const [editingCompany, setEditingCompany] = useState(false);
	const [editingContact, setEditingContact] = useState(false);
	const [editingCheckout, setEditingCheckout] = useState(false);

	type CheckoutOptions = {
		delivery: { standard: boolean; express: boolean; pickup: boolean };
		payment: { cod: boolean; card: boolean; gcash: boolean };
	};
	const EMPTY_CHECKOUT: CheckoutOptions = {
		delivery: { standard: false, express: false, pickup: false },
		payment: { cod: false, card: false, gcash: false },
	};
	const DELIVERY_OPTIONS = [
		{ key: 'standard' as const, label: 'Standard' },
		{ key: 'express' as const, label: 'Express' },
		{ key: 'pickup' as const, label: 'Pickup' },
	];
	const PAYMENT_METHODS = [
		{ key: 'cod' as const, label: 'COD' },
		{ key: 'card' as const, label: 'Debit / Credit Card' },
		{ key: 'gcash' as const, label: 'GCash' },
	];
	const [checkoutDraft, setCheckoutDraft] = useState<CheckoutOptions>(EMPTY_CHECKOUT);
	const [originalCheckout, setOriginalCheckout] = useState<CheckoutOptions>(EMPTY_CHECKOUT);

	// Only keep Vendor Enrollment state
	// Use the same category set as Inventory/Add Product
	const CATEGORY_OPTIONS = ['Consumables', 'Dental Equipment', 'Disposables', 'Equipment'];
	const [vendor, setVendor] = useState({
		categories: [] as string[],
		companyName: '',
		storeName: '',
		address: { street: '', barangay: '', municipality: '', province: '', region: '', location: '', zip: '' }, // split address
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
		bankName: '',
		bankAccountNumber: '',
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

	// Store original vendor data to reset on cancel
	const [originalVendor, setOriginalVendor] = useState(vendor);

	// Track existing uploaded documents from Firebase
	const [existingDocs, setExistingDocs] = useState<{
		bir?: { url: string; path: string };
		secOrDti?: { url: string; path: string };
		fdaLto?: { url: string; path: string };
		catalogue?: { url: string; path: string };
		warrantyPolicy?: { url: string; path: string };
	}>({});

	// Prefill vendor form from Firestore (Seller.vendor) if available
	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				if (!uid) return;
				const doc = await SellersService.get(uid);
				if (!mounted) return;

				// Hydrate top-level Checkout Options independently of vendor profile state
				const topLevelCheckout = (doc as any)?.checkoutOptions || {};
				const loadedCheckoutTop: CheckoutOptions = {
					delivery: { ...EMPTY_CHECKOUT.delivery, ...(topLevelCheckout.delivery || {}) },
					payment: { ...EMPTY_CHECKOUT.payment, ...(topLevelCheckout.payment || {}) },
				};
				setCheckoutDraft(loadedCheckoutTop);
				setOriginalCheckout(loadedCheckoutTop);

				const v: any = (doc as any)?.vendor || null;
				if (!v || Object.keys(v).length === 0) {
					// No vendor data exists - enable editing mode for first-time setup
					setIsEditing(true);
					return;
				}
				
				// Load existing document URLs
				if (v.bir || v.documents) {
					setExistingDocs({
						bir: v.bir || undefined,
						secOrDti: v.documents?.secOrDti || undefined,
						fdaLto: v.documents?.fdaLto || undefined,
						catalogue: v.documents?.catalogue || undefined,
						warrantyPolicy: v.documents?.warrantyPolicy || undefined,
					});
				}
				
				// Load profile and cover images
				setProfileImageUrl(v.profileImage?.url || '');
				setCoverImageUrl(v.coverImage?.url || '');
				
				const loadedVendorData = {
					categories: Array.isArray(v.categories) ? v.categories : [],
					companyName: v.company?.name || '',
					storeName: v.company?.storeName || '',
					address: {
						street: v.company?.address?.line1 || '',
						barangay: v.company?.address?.line2 || '',
						municipality: v.company?.address?.city || '',
						province: v.company?.address?.province || '',
						region: v.company?.address?.region || '',
						location: v.company?.address?.location || '',
						zip: v.company?.address?.zip || '',
					},
					contactPerson: v.contacts?.name || '',
					landline: v.contacts?.landline || '',
					mobile: v.contacts?.phone || '',
					email: v.contacts?.email || '',
					website: v.website || '',
					tin: v.tin || '',
					rdoCode: v.rdoCode || '',
					taxTypes: Array.isArray(v.taxTypes) ? v.taxTypes : [],
					lineOfBusiness: v.lineOfBusiness || '',
					dateOfRegistration: v.dateOfRegistration || '',
					bankName: v.bankName || '',
					bankAccountNumber: v.bankAccountNumber || '',
					bankBranchAddress: v.bankBranchAddress || '',
					merchantAgreement: null as File | null,
					requirements: {
						secOrDti: null as File | null,
						bir2303: null as File | null,
						fdaLto: null as File | null,
						catalogue: null as File | null,
						warrantyPolicy: null as File | null,
					},
				};
				
				setVendor(prev => ({
					...prev,
					...loadedVendorData,
				}));
				
				// Store as original data for reset on cancel
				setOriginalVendor(loadedVendorData);
			} catch (err) {
				console.error('Error loading vendor profile:', err);
			}
		})();
		return () => { mounted = false; };
	}, [uid]);

	// Validation state
	const [errors, setErrors] = useState<{ mobile: string; email: string; tin: string; tinOcr: string; zip?: string; regDate?: string }>({ mobile: '', email: '', tin: '', tinOcr: '' });
	// Top-level location group (filters Region; NCR short-circuits Province)
	const [location, setLocation] = useState<LocationGroup>('');
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
	const [attemptedNext, setAttemptedNext] = useState(false); // Track if user tried to proceed

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
	const [ocrFailed, setOcrFailed] = useState(false);
	const runTinOcrCheck = async (file: File) => {
		setOcrLoading(true);
		setOcrFailed(false);
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
			console.error('OCR failed:', e);
			setOcrFailed(true);
			// Non-blocking warning - allow user to proceed with manual entry
			setErrors(prev => ({ ...prev, tinOcr: 'OCR failed to read the image. You can proceed with manual entry.' }));
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

	// Comprehensive field validation for each step
	const step0Valid = useMemo(() => {
		// Step 0: BIR 2303 upload and extracted data confirmation
		return !!(
			vendor.requirements.bir2303 && 
			!extractionLoading && 
			userConfirmed &&
			vendor.tin && 
			!errors.tin &&
			vendor.companyName &&
			vendor.rdoCode &&
			vendor.lineOfBusiness &&
			vendor.dateOfRegistration &&
			vendor.taxTypes.length > 0 &&
			vendor.address.street &&
			vendor.address.municipality &&
			vendor.address.province &&
			vendor.address.zip &&
			!errors.zip
		);
	}, [vendor, extractionLoading, userConfirmed, errors.tin, errors.zip]);

	const step1Valid = useMemo(() => {
		// Step 1: Company Info, and Address
		return !!(
			vendor.companyName &&
			vendor.storeName &&
			vendor.contactPerson &&
			location &&
			vendor.address.street &&
			vendor.address.barangay &&
			vendor.address.municipality &&
			vendor.address.province &&
			vendor.address.zip &&
			!errors.zip
		);
	}, [vendor, errors.zip, location]);

	const step2Valid = useMemo(() => {
		// Step 2: Contacts, Banking, and Additional Documents
		return !!(
			vendor.mobile &&
			!errors.mobile &&
			vendor.email &&
			!errors.email &&
			vendor.bankName &&
			vendor.bankAccountNumber &&
			vendor.bankBranchAddress &&
			vendor.requirements.secOrDti &&
			vendor.requirements.fdaLto
		);
	}, [vendor, errors.mobile, errors.email]);

	// Per-step validation gating
	const canProceed = useMemo(() => {
		switch (step) {
			case 0:
				return step0Valid;
			case 1:
				return step1Valid;
			case 2:
				return step2Valid;
			default:
				return true;
		}
	}, [step, step0Valid, step1Valid, step2Valid]);
	
	const next = () => {
		setAttemptedNext(true);
		if (canProceed) {
			setStep(s => Math.min(s + 1, STEPS.length - 1));
			setAttemptedNext(false); // Reset for next step
		}
	};
	
	const back = () => {
		setStep(s => Math.max(s - 1, 0));
		setAttemptedNext(false); // Reset when going back
	};

	// Get list of missing required fields for current step
	const getMissingFields = () => {
		const missing: string[] = [];
		
		switch (step) {
			case 0:
				if (!vendor.requirements.bir2303 && !existingDocs.bir) missing.push('BIR 2303 document');
				if (!userConfirmed) missing.push('Confirmation of extracted details');
				if (!vendor.tin || errors.tin) missing.push('Valid TIN');
				if (!vendor.companyName) missing.push('Company Name');
				if (!vendor.rdoCode) missing.push('RDO Code');
				if (!vendor.lineOfBusiness) missing.push('Line of Business');
				if (!vendor.dateOfRegistration) missing.push('Date of Registration');
				if (!vendor.taxTypes.length) missing.push('At least one Tax Type');
				if (!vendor.address.street) missing.push('Street Address');
				if (!vendor.address.municipality) missing.push('Municipality/City');
				if (!vendor.address.province) missing.push('Province');
				if (!vendor.address.zip || errors.zip) missing.push('Valid ZIP Code');
				break;
			case 1:
				if (!vendor.companyName) missing.push('Company Name');
				if (!vendor.storeName) missing.push('Store Name');
				if (!vendor.contactPerson) missing.push('Customer Service Contact Person');
				if (!location) missing.push('Location');
				if (!vendor.address.province) missing.push('Province');
				if (!vendor.address.municipality) missing.push('Municipality/City');
				if (!vendor.address.barangay) missing.push('Barangay');
				if (!vendor.address.street) missing.push('Street Address');
				if (!vendor.address.zip || errors.zip) missing.push('Valid ZIP Code');
				break;
			case 2:
				if (!vendor.mobile || errors.mobile) missing.push('Valid Mobile Number');
				if (!vendor.email || errors.email) missing.push('Valid Email Address');
				if (!vendor.bankName) missing.push('Bank Name');
				if (!vendor.bankAccountNumber) missing.push('Bank Account Number');
				if (!vendor.bankBranchAddress) missing.push('Bank Branch Address');
				if (!vendor.requirements.secOrDti && !existingDocs.secOrDti) missing.push('SEC Certificate or DTI Registration');
				if (!vendor.requirements.fdaLto && !existingDocs.fdaLto) missing.push('FDA LTO Medical Device');
				break;
		}
		
		return missing;
	};

	const Title = useMemo(() => (
		<div className="flex items-center justify-between">
			<h2 className="text-base font-semibold text-gray-900">Vendor Enrollment</h2>
			<div className="flex items-center gap-2">
				{!vendorProfileComplete && (
					<button 
						onClick={() => {
							localStorage.removeItem('dentpal_vendor_welcome_seen');
							setShowWelcome(true);
						}} 
						className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
						title="View enrollment guide"
					>
						<span>❓</span> Guide
					</button>
				)}
				{/* Only show Edit button if profile is complete */}
				{vendorProfileComplete && !isEditing ? (
					<button onClick={() => setIsEditing(true)} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50">
						<Pencil className="w-4 h-4" /> Edit
					</button>
				) : vendorProfileComplete && isEditing ? (
					<>
						<button onClick={() => {
							// Reset to original vendor data
							setVendor(originalVendor);
							// Clear any validation errors
							setErrors({ mobile: '', email: '', tin: '', tinOcr: '' });
							// Exit editing mode
							setIsEditing(false);
						}} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50">
							<X className="w-4 h-4" /> Cancel
						</button>
						<button
							disabled={saving}
							onClick={async () => {
								setSaving(true);
								try {
									if (!uid) return;
									// Save the updated vendor profile to Firestore
									await SellersService.saveVendorProfile(uid, {
										categories: vendor.categories,
										tin: vendor.tin,
										rdoCode: vendor.rdoCode,
										taxTypes: vendor.taxTypes,
										lineOfBusiness: vendor.lineOfBusiness,
										dateOfRegistration: vendor.dateOfRegistration,
										company: {
											name: vendor.companyName,
											storeName: vendor.storeName,
											address: {
												line1: vendor.address.street,
												line2: vendor.address.barangay,
												city: vendor.address.municipality,
												province: vendor.address.province,
												zip: vendor.address.zip,
											},
										},
										contacts: {
											name: vendor.contactPerson,
											phone: vendor.mobile,
											email: vendor.email,
											landline: vendor.landline,
										},
										website: vendor.website,
										bankName: vendor.bankName,
										bankAccountNumber: vendor.bankAccountNumber,
										bankBranchAddress: vendor.bankBranchAddress,
									} as any);
									// Update original vendor after successful save
									setOriginalVendor(vendor);
									setIsEditing(false);
								} catch (error: any) {
									console.error('Failed to save profile:', error);
									alert('Failed to save profile: ' + (error.message || 'Unknown error'));
								} finally { 
									setSaving(false); 
								}
							}}
							className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
						>
							{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
						</button>
					</>
				) : null}
			</div>
		</div>
	), [isEditing, saving, vendorProfileComplete, vendor, originalVendor, uid, errors]);

	// Completed summary view (read-only)
	const renderCompletedSummary = () => {
		return (
		<div className="space-y-4">
			<div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
				{/* Header with Action Buttons */}
				<div className="bg-gradient-to-r from-teal-600 to-teal-700 px-8 py-6">
					<div className="flex items-center justify-between">
						<div>
							<div className="text-white font-bold text-2xl mb-1">Vendor Profile</div>
							<div className="text-teal-100 text-sm">Complete enrollment information</div>
						</div>
					</div>
				</div>

				<div className="p-6 space-y-6">
					{/* Profile and Cover Images Section - Enhanced */}
					<div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100">
						<div className="flex items-center gap-2 mb-5">
							<svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
							</svg>
							<h3 className="text-base font-semibold text-gray-900">Profile Images</h3>
						</div>
						
						<div className="grid md:grid-cols-2 gap-6">
							{/* Profile Image */}
							<div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200">
								<div className="flex items-center justify-between mb-3">
									<div className="text-sm font-semibold text-gray-700">Profile Image</div>
									{profileImageUrl && (
										<span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
											<CheckCircle2 className="w-3 h-3 mr-1" />
											Uploaded
										</span>
									)}
								</div>
								<div className="mb-4">
									{profileImageUrl ? (
										<div className="relative rounded-lg border-2 border-gray-200 bg-gray-50 overflow-hidden mx-auto" style={{ width: '180px', height: '180px' }}>
											<img
												src={profileImageUrl}
												alt="Profile"
												className="w-full h-full object-cover"
												onError={(e) => {
													const target = e.target as HTMLImageElement;
													target.style.display = 'none';
													const parent = target.parentElement;
													if (parent) {
														parent.innerHTML = '<div class="w-full h-full flex items-center justify-center text-gray-400 text-xs">No image</div>';
													}
												}}
											/>
										</div>
									) : (
										<div className="relative rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 overflow-hidden mx-auto flex items-center justify-center" style={{ width: '180px', height: '180px' }}>
											<div className="text-center">
												<svg className="w-12 h-12 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
												</svg>
												<p className="text-xs text-gray-500">No profile image</p>
											</div>
										</div>
									)}
								</div>
								<button
									className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 text-white font-medium rounded-lg hover:bg-teal-700 transition shadow-sm"
									onClick={() => setProfileUploadOpen(true)}
								>
									<Upload className="w-4 h-4" />
									Upload Profile Image
								</button>
							</div>

							{/* Cover Image */}
							<div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200">
								<div className="flex items-center justify-between mb-3">
									<div className="text-sm font-semibold text-gray-700">Cover Image</div>
									{coverImageUrl && (
										<span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
											<CheckCircle2 className="w-3 h-3 mr-1" />
											Uploaded
										</span>
									)}
								</div>
								<div className="mb-4">
									{coverImageUrl ? (
										<div className="relative rounded-lg border-2 border-gray-200 bg-gray-50 overflow-hidden" style={{ width: '100%', height: '180px' }}>
											<img
												src={coverImageUrl}
												alt="Cover"
												className="w-full h-full object-cover"
												onError={(e) => {
													const target = e.target as HTMLImageElement;
													target.style.display = 'none';
													const parent = target.parentElement;
													if (parent) {
														parent.innerHTML = '<div class="w-full h-full flex items-center justify-center text-gray-400 text-xs">No image</div>';
													}
												}}
											/>
										</div>
									) : (
										<div className="relative rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 overflow-hidden flex items-center justify-center" style={{ width: '100%', height: '180px' }}>
											<div className="text-center">
												<svg className="w-12 h-12 mx-auto text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
												</svg>
												<p className="text-xs text-gray-500">No cover image</p>
											</div>
										</div>
									)}
								</div>
								<button
									className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition shadow-sm"
									onClick={() => setCoverUploadOpen(true)}
								>
									<Upload className="w-4 h-4" />
									Upload Cover Image
								</button>
							</div>
						</div>
					</div>

					{/* Checkout Options */}
					<div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-100">
						<div className="flex items-center justify-between mb-5">
							<div className="flex items-center gap-2">
								<svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
								</svg>
								<h3 className="text-base font-semibold text-gray-900">Checkout Options</h3>
							</div>
							{!editingCheckout ? (
								<button
									onClick={() => setEditingCheckout(true)}
									className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
								>
									<Pencil className="w-3.5 h-3.5" /> Edit
								</button>
							) : (
								<div className="flex gap-2">
									<button
										onClick={() => {
											setCheckoutDraft(originalCheckout);
											setEditingCheckout(false);
										}}
										className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50"
									>
										<X className="w-3.5 h-3.5" /> Cancel
									</button>
									<button
										disabled={saving}
										onClick={async () => {
											if (!uid) return;
											setSaving(true);
											try {
												await SellersService.saveSellerFields(uid, { checkoutOptions: checkoutDraft });
												setOriginalCheckout(checkoutDraft);
												setEditingCheckout(false);
											} catch (error: any) {
												alert('Failed to save: ' + (error.message || 'Unknown error'));
											} finally {
												setSaving(false);
											}
										}}
										className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
									>
										{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
									</button>
								</div>
							)}
						</div>
						<div className="grid md:grid-cols-2 gap-6">
							<div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200">
								<div className="text-sm font-semibold text-gray-900 mb-3">Delivery Options</div>
								{editingCheckout ? (
									<div className="space-y-2">
										{DELIVERY_OPTIONS.map(opt => (
											<label key={opt.key} className="flex items-center gap-2 cursor-pointer">
												<input
													type="checkbox"
													checked={checkoutDraft.delivery[opt.key]}
													onChange={(e) => setCheckoutDraft(d => ({
														...d,
														delivery: { ...d.delivery, [opt.key]: e.target.checked },
													}))}
													className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
												/>
												<span className="text-sm text-gray-800">{opt.label}</span>
											</label>
										))}
									</div>
								) : (
									<div className="flex flex-wrap gap-1.5">
										{DELIVERY_OPTIONS.filter(o => originalCheckout.delivery[o.key]).map(o => (
											<span key={o.key} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
												{o.label}
											</span>
										))}
										{!DELIVERY_OPTIONS.some(o => originalCheckout.delivery[o.key]) && (
											<span className="text-sm text-gray-400">No delivery options set yet.</span>
										)}
									</div>
								)}
							</div>
							<div className="bg-white rounded-lg p-5 shadow-sm border border-gray-200">
								<div className="text-sm font-semibold text-gray-900 mb-3">Payment Methods</div>
								{editingCheckout ? (
									<div className="space-y-2">
										{PAYMENT_METHODS.map(opt => (
											<label key={opt.key} className="flex items-center gap-2 cursor-pointer">
												<input
													type="checkbox"
													checked={checkoutDraft.payment[opt.key]}
													onChange={(e) => setCheckoutDraft(d => ({
														...d,
														payment: { ...d.payment, [opt.key]: e.target.checked },
													}))}
													className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
												/>
												<span className="text-sm text-gray-800">{opt.label}</span>
											</label>
										))}
									</div>
								) : (
									<div className="flex flex-wrap gap-1.5">
										{PAYMENT_METHODS.filter(o => originalCheckout.payment[o.key]).map(o => (
											<span key={o.key} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
												{o.label}
											</span>
										))}
										{!PAYMENT_METHODS.some(o => originalCheckout.payment[o.key]) && (
											<span className="text-sm text-gray-400">No payment methods set yet.</span>
										)}
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Section 1: BIR Information */}
					<div className="border border-gray-200 rounded-lg p-5 bg-gray-50">
						<div className="flex items-center mb-4">
							<div className="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center">
								<span className="text-teal-700 font-semibold text-sm">1</span>
							</div>
							<h3 className="font-semibold text-gray-900 ml-2">BIR Information</h3>
						</div>
						<div className="bg-white rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">BIR Document</div>
								{editingBIR ? (
									<div className="space-y-2">
										{existingDocs.bir && (
											<div className="text-xs text-gray-600">
												Current: {existingDocs.bir.path?.split('/').pop() || 'bir2303.pdf'}
											</div>
										)}
										<Input
											type="file"
											accept=".pdf,.jpg,.jpeg,.png"
											onChange={(e) => {
												const file = e.target.files?.[0];
												if (file) {
													setVendor(v => ({ ...v, requirements: { ...v.requirements, bir2303: file } }));
												}
											}}
											className="h-8 text-xs"
										/>
									</div>
								) : (
									<div className="text-sm text-gray-900 flex items-center gap-2">
										{existingDocs.bir ? (
											<>
												<span className="inline-flex items-center gap-1 text-teal-700">
													<CheckCircle2 className="w-4 h-4" />
													{existingDocs.bir.path?.split('/').pop() || 'bir2303.pdf'}
												</span>
											</>
										) : (
											<span className="text-gray-400">No file uploaded</span>
										)}
									</div>
								)}
							</div>
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">TIN</div>
								{editingBIR ? (
									<Input 
										value={formatTin(vendor.tin)} 
										onChange={(e) => setField('tin', normalizeTin(e.target.value))}
										className="h-8 text-sm font-mono"
										placeholder="000-000-000-000"
									/>
								) : (
									<div className="text-sm text-gray-900 font-mono">{formatTin(vendor.tin) || '-'}</div>
								)}
							</div>
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">Registered Trade Name</div>
								{editingBIR ? (
									<Input 
										value={vendor.companyName} 
										onChange={(e) => setField('companyName', e.target.value)}
										className="h-8 text-sm"
										placeholder="Company Name"
									/>
								) : (
									<div className="text-sm text-gray-900">{vendor.companyName || '-'}</div>
								)}
							</div>
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">Date of Registration</div>
								{editingBIR ? (
									<Input 
										type="date"
										value={vendor.dateOfRegistration} 
										onChange={(e) => setField('dateOfRegistration', e.target.value)}
										className="h-8 text-sm"
									/>
								) : (
									<div className="text-sm text-gray-900">{vendor.dateOfRegistration || '-'}</div>
								)}
							</div>
							<div className="md:col-span-2">
								<div className="text-xs font-medium text-gray-500 mb-1">Tax Type</div>
								{editingBIR ? (
									<div className="space-y-2">
										<div className="flex flex-wrap gap-1">
											{(vendor.taxTypes || []).map(tax => (
												<span key={tax} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
													{tax}
													<button
														type="button"
														onClick={() => setVendor(v => ({ ...v, taxTypes: v.taxTypes.filter(t => t !== tax) }))}
														className="hover:text-blue-900"
													>
														<X className="w-3 h-3" />
													</button>
												</span>
											))}
											{(!vendor.taxTypes || vendor.taxTypes.length === 0) && <span className="text-xs text-gray-400">No tax types selected</span>}
										</div>
										<select
											value=""
											onChange={(e) => {
												if (e.target.value && !vendor.taxTypes.includes(e.target.value)) {
													setVendor(v => ({ ...v, taxTypes: [...v.taxTypes, e.target.value] }));
												}
											}}
											className="w-full h-8 text-xs border border-gray-300 rounded-md px-2"
										>
											<option value="">+ Add Tax Type</option>
											{TAX_TYPE_CATALOG.map(tax => (
												<option key={tax} value={tax} disabled={vendor.taxTypes.includes(tax)}>
													{tax}
												</option>
											))}
										</select>
									</div>
								) : (
									<div className="flex flex-wrap gap-1">
										{(vendor.taxTypes || []).map(tax => (
											<span key={tax} className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
												{tax}
											</span>
										))}
										{(!vendor.taxTypes || vendor.taxTypes.length === 0) && <span className="text-sm text-gray-400">-</span>}
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Section 2: Company Information */}
					<div className="border border-gray-200 rounded-lg p-5 bg-gray-50">
						<div className="flex items-center justify-between mb-4">
							<div className="flex items-center gap-2">
								<div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
									<span className="text-purple-700 font-semibold text-sm">2</span>
								</div>
								<h3 className="font-semibold text-gray-900">Company Information</h3>
							</div>
							{!editingCompany ? (
								<button
									onClick={() => {
										setEditingCompany(true);
										hydrateAddressCascadeFromSaved();
									}}
									className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
								>
									<Pencil className="w-3.5 h-3.5" /> Edit
								</button>
							) : (
								<div className="flex gap-2">
									<button
										onClick={() => {
											setVendor(originalVendor);
											setEditingCompany(false);
											setLocation('');
											setSelectedRegion(''); setSelectedProvince(''); setSelectedCity(''); setSelectedBarangay('');
											setProvinces([]); setCities([]); setBarangays([]);
										}}
										className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
									>
										<X className="w-3.5 h-3.5" /> Cancel
									</button>
									<button 
										disabled={saving}
										onClick={async () => {
											setSaving(true);
											try {
												if (!uid) return;
												await SellersService.saveVendorProfile(uid, {
													company: {
														name: vendor.companyName,
														storeName: vendor.storeName,
														address: {
															line1: vendor.address.street,
															line2: vendor.address.barangay,
															city: vendor.address.municipality,
															province: vendor.address.province,
															region: vendor.address.region,
															location: vendor.address.location,
															zip: vendor.address.zip,
														},
													},
												} as any);
												setOriginalVendor(vendor);
												setEditingCompany(false);
												setLocation('');
												setSelectedRegion(''); setSelectedProvince(''); setSelectedCity(''); setSelectedBarangay('');
												setProvinces([]); setCities([]); setBarangays([]);
											} catch (error: any) {
												alert('Failed to save: ' + (error.message || 'Unknown error'));
											} finally { 
												setSaving(false); 
											}
										}}
										className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
									>
										{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
									</button>
								</div>
							)}
						</div>
						<div className="bg-white rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">Company Name</div>
								{editingCompany ? (
									<Input
										value={vendor.companyName}
										onChange={(e) => setField('companyName', e.target.value)}
										className="h-8 text-sm"
										placeholder="Company Name"
									/>
								) : (
									<div className="text-sm text-gray-900">{vendor.companyName || '-'}</div>
								)}
							</div>
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">Store Name</div>
								{editingCompany ? (
									<Input
										value={vendor.storeName}
										onChange={(e) => setField('storeName', e.target.value)}
										className="h-8 text-sm"
										placeholder="Store Name"
									/>
								) : (
									<div className="text-sm text-gray-900">{vendor.storeName || '-'}</div>
								)}
							</div>
							{editingCompany && (
								<div className="md:col-span-2">
									<div className="text-xs font-medium text-gray-500 mb-1">Location</div>
									<select value={location} onChange={(e)=> onLocationSelect(e.target.value as LocationGroup)} className="w-full text-sm p-2 border border-gray-200 rounded-lg h-8">
										<option value="">Select location</option>
										<option value="NCR">NCR</option>
										<option value="Luzon">Luzon</option>
										<option value="Visayas">Visayas</option>
										<option value="Mindanao">Mindanao</option>
									</select>
								</div>
							)}
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">Region</div>
								{editingCompany ? (
									<select disabled={!location || location === 'NCR'} value={selectedRegion} onChange={(e)=> onRegionSelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg h-8 disabled:bg-gray-50">
										<option value="">Select region</option>
										{regions.filter(r => location && regionToLocation(r.name) === location).map(r => (<option key={r.code} value={r.code}>{r.name}</option>))}
									</select>
								) : (
									<div className="text-sm text-gray-900">{vendor.address.region || '-'}</div>
								)}
							</div>
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">Province</div>
								{editingCompany ? (
									location === 'NCR' ? (
										<Input value="Metro Manila" disabled className="h-8 text-sm bg-gray-50" />
									) : (
										<select disabled={!selectedRegion} value={selectedProvince} onChange={(e)=> onProvinceSelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg h-8 disabled:bg-gray-50">
											<option value="">Select province</option>
											{provinces.map(p => (<option key={p.code} value={p.code}>{p.name}</option>))}
										</select>
									)
								) : (
									<div className="text-sm text-gray-900">{vendor.address.province || '-'}</div>
								)}
							</div>
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">Municipality/City</div>
								{editingCompany ? (
									<select disabled={location !== 'NCR' && !selectedProvince} value={selectedCity} onChange={(e)=> onCitySelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg h-8 disabled:bg-gray-50">
										<option value="">Select city/municipality</option>
										{cities.map(c => (<option key={c.code} value={c.code}>{c.name}</option>))}
									</select>
								) : (
									<div className="text-sm text-gray-900">{vendor.address.municipality || '-'}</div>
								)}
							</div>
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">Barangay</div>
								{editingCompany ? (
									<select disabled={!selectedCity} value={selectedBarangay} onChange={(e)=> onBarangaySelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg h-8 disabled:bg-gray-50">
										<option value="">Select barangay</option>
										{barangays.map(b => (<option key={b.code} value={b.code}>{b.name}</option>))}
									</select>
								) : (
									<div className="text-sm text-gray-900">{vendor.address.barangay || '-'}</div>
								)}
							</div>
							<div className="md:col-span-2">
								<div className="text-xs font-medium text-gray-500 mb-1">Street</div>
								{editingCompany ? (
									<Input
										value={vendor.address.street}
										onChange={(e) => setVendor(v => ({ ...v, address: { ...v.address, street: e.target.value } }))}
										className="h-8 text-sm"
										placeholder="Street Address"
									/>
								) : (
									<div className="text-sm text-gray-900">{vendor.address.street || '-'}</div>
								)}
							</div>
							<div>
								<div className="text-xs font-medium text-gray-500 mb-1">ZIP Code</div>
								{editingCompany ? (
									<Input
										value={vendor.address.zip}
										onChange={(e) => setVendor(v => ({ ...v, address: { ...v.address, zip: e.target.value } }))}
										className="h-8 text-sm"
										placeholder="0000"
										maxLength={4}
									/>
								) : (
									<div className="text-sm text-gray-900">{vendor.address.zip || '-'}</div>
								)}
							</div>
						</div>
					</div>

					{/* Section 3: Contact & Documents */}
					<div className="border border-gray-200 rounded-lg p-5 bg-gray-50">
						<div className="flex items-center justify-between mb-4">
							<div className="flex items-center gap-2">
								<div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
									<span className="text-blue-700 font-semibold text-sm">3</span>
								</div>
								<h3 className="font-semibold text-gray-900">Contact & Documents</h3>
							</div>
							{!editingContact ? (
								<button 
									onClick={() => setEditingContact(true)}
									className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
								>
									<Pencil className="w-3.5 h-3.5" /> Edit
								</button>
							) : (
								<div className="flex gap-2">
									<button 
										onClick={() => {
											setVendor(originalVendor);
											setEditingContact(false);
										}}
										className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
									>
										<X className="w-3.5 h-3.5" /> Cancel
									</button>
									<button 
										disabled={saving}
										onClick={async () => {
											setSaving(true);
											try {
												if (!uid) return;
												await SellersService.saveVendorProfile(uid, {
													contacts: {
														name: vendor.contactPerson,
														phone: vendor.mobile,
														email: vendor.email,
														landline: vendor.landline,
													},
													website: vendor.website,
													bankName: vendor.bankName,
													bankAccountNumber: vendor.bankAccountNumber,
													bankBranchAddress: vendor.bankBranchAddress,
												} as any);
												setOriginalVendor(vendor);
												setEditingContact(false);
											} catch (error: any) {
												alert('Failed to save: ' + (error.message || 'Unknown error'));
											} finally { 
												setSaving(false); 
											}
										}}
										className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40"
									>
										{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
									</button>
								</div>
							)}
						</div>
						<div className="bg-white rounded-lg p-4 space-y-4">
							{/* Contact Information */}
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-gray-100">
								<div>
									<div className="text-xs font-medium text-gray-500 mb-1">Customer Service Contact Person</div>
									{editingContact ? (
										<Input 
											value={vendor.contactPerson} 
											onChange={(e) => setField('contactPerson', e.target.value)}
											className="h-8 text-sm"
											placeholder="Contact Person Name"
										/>
									) : (
										<div className="text-sm text-gray-900">{vendor.contactPerson || '-'}</div>
									)}
								</div>
								<div>
									<div className="text-xs font-medium text-gray-500 mb-1">Mobile No</div>
									{editingContact ? (
										<Input 
											value={formatMobile(vendor.mobile)} 
											onChange={onMobileChange}
											className="h-8 text-sm font-mono"
											placeholder="09XX XXX XXXX"
										/>
									) : (
										<div className="text-sm text-gray-900 font-mono">{vendor.mobile || '-'}</div>
									)}
								</div>
							</div>
							
							{/* Banking Information */}
							<div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-gray-100">
								<div>
									<div className="text-xs font-medium text-gray-500 mb-1">Bank Name</div>
									{editingContact ? (
										<Input 
											value={vendor.bankName} 
											onChange={(e) => setField('bankName', e.target.value)}
											className="h-8 text-sm"
											placeholder="Bank Name"
										/>
									) : (
										<div className="text-sm text-gray-900">{vendor.bankName || '-'}</div>
									)}
								</div>
								<div>
									<div className="text-xs font-medium text-gray-500 mb-1">Bank Account Number</div>
									{editingContact ? (
										<Input 
											value={vendor.bankAccountNumber} 
											onChange={(e) => setField('bankAccountNumber', e.target.value)}
											className="h-8 text-sm font-mono"
											placeholder="Account Number"
										/>
									) : (
										<div className="text-sm text-gray-900 font-mono">{vendor.bankAccountNumber || '-'}</div>
									)}
								</div>
								<div>
									<div className="text-xs font-medium text-gray-500 mb-1">Bank Branch Address</div>
									{editingContact ? (
										<Input 
											value={vendor.bankBranchAddress} 
											onChange={(e) => setField('bankBranchAddress', e.target.value)}
											className="h-8 text-sm"
											placeholder="Bank Branch Address"
										/>
									) : (
										<div className="text-sm text-gray-900">{vendor.bankBranchAddress || '-'}</div>
									)}
								</div>
							</div>
							
							{/* Required Documents */}
							<div>
								<div className="text-xs font-medium text-gray-500 mb-3">Required Documents</div>
								{editingContact ? (
									<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
										{/* SEC/DTI Document */}
										<div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
											<div className="text-xs font-medium text-gray-700">SEC Certificate / DTI Registration</div>
											{existingDocs.secOrDti && (
												<div className="text-xs text-gray-600">
													Current: {existingDocs.secOrDti.path?.split('/').pop() || 'sec-dti.pdf'}
												</div>
											)}
											<Input
												type="file"
												accept=".pdf,.jpg,.jpeg,.png"
												onChange={(e) => {
													const file = e.target.files?.[0];
													if (file) {
														setVendor(v => ({ ...v, requirements: { ...v.requirements, secOrDti: file } }));
													}
												}}
												className="h-8 text-xs"
											/>
										</div>
										{/* FDA LTO Document */}
										<div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
											<div className="text-xs font-medium text-gray-700">FDA LTO Medical Device</div>
											{existingDocs.fdaLto && (
												<div className="text-xs text-gray-600">
													Current: {existingDocs.fdaLto.path?.split('/').pop() || 'fda-lto.pdf'}
												</div>
											)}
											<Input
												type="file"
												accept=".pdf,.jpg,.jpeg,.png"
												onChange={(e) => {
													const file = e.target.files?.[0];
													if (file) {
														setVendor(v => ({ ...v, requirements: { ...v.requirements, fdaLto: file } }));
													}
												}}
												className="h-8 text-xs"
											/>
										</div>
									</div>
								) : (
									<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
										<div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
											<CheckCircle2 className="w-5 h-5 text-teal-600 flex-shrink-0" />
											<div className="flex-1 min-w-0">
												<div className="text-xs text-gray-500">SEC Certificate / DTI Registration</div>
												<div className="text-sm text-gray-900 truncate">
													{existingDocs.secOrDti ? existingDocs.secOrDti.path?.split('/').pop() || 'sec-dti.pdf' : '-'}
												</div>
											</div>
										</div>
										<div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
											<CheckCircle2 className="w-5 h-5 text-teal-600 flex-shrink-0" />
											<div className="flex-1 min-w-0">
												<div className="text-xs text-gray-500">FDA LTO Medical Device</div>
												<div className="text-sm text-gray-900 truncate">
													{existingDocs.fdaLto ? existingDocs.fdaLto.path?.split('/').pop() || 'fda-lto.pdf' : '-'}
												</div>
											</div>
										</div>
									</div>
								)}
							</div>
						</div>
					</div>
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
	};

	// Helpers
	const toggleCategory = (cat: string) => {
		setVendor(v => ({ ...v, categories: v.categories.includes(cat) ? v.categories.filter(c => c !== cat) : [...v.categories, cat] }));
	};
	const setField = (k: keyof typeof vendor, val: any) => setVendor(v => ({ ...v, [k]: val }));
	const setReqFile = (k: keyof typeof vendor.requirements, file: File | null) => {
		setVendor(v => ({ ...v, requirements: { ...v.requirements, [k]: file } }));
		if (k === 'bir2303' && file) {
			// Reset OCR failure state
			setOcrFailed(false);
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
					try {
						const canvas = await canvasFromPdfFirstPage(data);
						const dataUrl = canvas.toDataURL('image/png');
						const { data: ocr } = await Tesseract.recognize(dataUrl, 'eng', { logger: () => {} });
						text = ocr.text || '';
						source = 'ocr-pdf-render';
					} catch (ocrError) {
						console.error('OCR on PDF failed:', ocrError);
						// Allow user to proceed without extracted data
						source = 'unknown';
					}
				}
			} else {
				try {
					const { data: ocr } = await Tesseract.recognize(file, 'eng', { logger: () => {} });
					text = ocr.text || '';
					source = 'ocr-image';
				} catch (ocrError) {
					console.error('OCR on image failed:', ocrError);
					// Allow user to proceed without extracted data
					source = 'unknown';
				}
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
			console.error('Document extraction failed:', e);
			// Set empty suggestions to allow manual entry
			setSuggestions({ textSource: 'unknown', values: {}, confidence: {} });
			setSuggestionsOpen(true);
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
	// Map from province name (lowercased) to its parent region { code, name }
	const [provinceToRegion, setProvinceToRegion] = useState<Record<string, { code: string; name: string }>>({});
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
				// Build province-name → parent region map for location hydration
				const pMap: Record<string, { code: string; name: string }> = {};
				regionsMapped.forEach((r, idx) => {
					provinceGroups[idx]?.forEach(p => {
						pMap[p.name.toLowerCase()] = { code: r.code, name: r.name };
					});
				});
				setProvinceToRegion(pMap);
			} catch (err) {
				console.error('Failed loading regions/provinces', err);
				setRegions([]);
				setAllProvinces([]);
			}
		})();
	}, []);

	// Hydrate the full cascade (location → region → province → city → barangay)
	// from the currently saved vendor address. Used when entering edit mode on
	// the Company Information section of an existing profile.
	const hydrateAddressCascadeFromSaved = async () => {
		const prov = vendor.address.province;
		const cityName = vendor.address.municipality;
		const brgyName = vendor.address.barangay;
		if (!prov || regions.length === 0) return;
		try {
			const api = await getAddressApi();
			if (prov.toLowerCase() === 'metro manila') {
				const ncr = regions.find(r => regionToLocation(r.name) === 'NCR');
				if (!ncr) return;
				setLocation('NCR');
				setSelectedRegion(ncr.code);
				setVendor(v => ({ ...v, address: { ...v.address, location: 'NCR', region: ncr.name } }));
				const districts = await api.provinces(ncr.code);
				const cityGroups = await Promise.all(
					districts.map(async (d: any) => {
						const dCode = d.province_code ?? d.code;
						try {
							const list = await api.cities(dCode);
							return list.map((c: any) => ({ code: c.city_code ?? c.municipality_code ?? c.code, name: c.city_name ?? c.municipality_name ?? c.name }));
						} catch { return [] as Array<{ code: string; name: string }>; }
					})
				);
				const seen = new Set<string>();
				const merged: Array<{ code: string; name: string }> = [];
				for (const c of cityGroups.flat()) if (!seen.has(c.code)) { seen.add(c.code); merged.push(c); }
				merged.sort((a, b) => a.name.localeCompare(b.name));
				setCities(merged);
				const cityMatch = merged.find(c => c.name.toLowerCase() === (cityName || '').toLowerCase());
				if (cityMatch) {
					setSelectedCity(cityMatch.code);
					const bList = await api.barangays(cityMatch.code);
					const brgys = bList.map((b: any) => ({ code: b.brgy_code ?? b.barangay_code ?? b.code, name: b.brgy_name ?? b.barangay_name ?? b.name }));
					setBarangays(brgys);
					const brgyMatch = brgys.find(b => b.name.toLowerCase() === (brgyName || '').toLowerCase());
					if (brgyMatch) setSelectedBarangay(brgyMatch.code);
				}
				return;
			}
			const parent = provinceToRegion[prov.toLowerCase()];
			if (!parent) return;
			const group = regionToLocation(parent.name);
			if (!group) return;
			setLocation(group);
			setSelectedRegion(parent.code);
			setVendor(v => ({ ...v, address: { ...v.address, location: group, region: parent.name } }));
			const pList = await api.provinces(parent.code);
			const provs = pList.map((p: any) => ({ code: p.province_code ?? p.code, name: p.province_name ?? p.name }));
			setProvinces(provs);
			const provMatch = provs.find(p => p.name.toLowerCase() === prov.toLowerCase());
			if (!provMatch) return;
			setSelectedProvince(provMatch.code);
			const cList = await api.cities(provMatch.code);
			const cityOpts = cList.map((c: any) => ({ code: c.city_code ?? c.municipality_code ?? c.code, name: c.city_name ?? c.municipality_name ?? c.name }));
			setCities(cityOpts);
			const cityMatch = cityOpts.find(c => c.name.toLowerCase() === (cityName || '').toLowerCase());
			if (!cityMatch) return;
			setSelectedCity(cityMatch.code);
			const bList = await api.barangays(cityMatch.code);
			const brgys = bList.map((b: any) => ({ code: b.brgy_code ?? b.barangay_code ?? b.code, name: b.brgy_name ?? b.barangay_name ?? b.name }));
			setBarangays(brgys);
			const brgyMatch = brgys.find(b => b.name.toLowerCase() === (brgyName || '').toLowerCase());
			if (brgyMatch) setSelectedBarangay(brgyMatch.code);
		} catch (err) {
			console.error('Failed hydrating address cascade', err);
		}
	};

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

	const onLocationSelect = async (loc: LocationGroup) => {
		setLocation(loc);
		setSelectedRegion(''); setSelectedProvince(''); setSelectedCity(''); setSelectedBarangay('');
		setProvinces([]); setCities([]); setBarangays([]);
		setVendor(v => ({ ...v, address: { ...v.address, location: loc, region: '', province: '', municipality: '', barangay: '', zip: '' } }));
		if (!loc) return;
		if (loc === 'NCR') {
			const ncr = regions.find(r => regionToLocation(r.name) === 'NCR');
			if (!ncr) return;
			setSelectedRegion(ncr.code);
			setVendor(v => ({ ...v, address: { ...v.address, region: ncr.name, province: 'Metro Manila' } }));
			try {
				const api = await getAddressApi();
				const districts = await api.provinces(ncr.code);
				const cityGroups = await Promise.all(
					districts.map(async (d: any) => {
						const dCode = d.province_code ?? d.code;
						try {
							const list = await api.cities(dCode);
							return list.map((c: any) => ({ code: c.city_code ?? c.municipality_code ?? c.code, name: c.city_name ?? c.municipality_name ?? c.name }));
						} catch { return [] as Array<{ code: string; name: string }>; }
					})
				);
				const seen = new Set<string>();
				const merged: Array<{ code: string; name: string }> = [];
				for (const c of cityGroups.flat()) {
					if (!seen.has(c.code)) { seen.add(c.code); merged.push(c); }
				}
				merged.sort((a, b) => a.name.localeCompare(b.name));
				setCities(merged);
			} catch (err) {
				console.error('Failed loading NCR cities', err);
			}
		}
	};

	const onRegionSelect = async (code: string) => {
		setSelectedRegion(code);
		setSelectedProvince(''); setSelectedCity(''); setSelectedBarangay('');
		const regionName = regions.find(r => r.code === code)?.name || '';
		setVendor(v => ({ ...v, address: { ...v.address, region: regionName, province: '', municipality: '', barangay: '' } }));
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

	const submitEnrollment = async () => {
		setSubmitLoading(true);
		try {
			if (!uid) { throw new Error('Not signed in'); }
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
				company: { name: vendor.companyName, storeName: vendor.storeName, address: { line1: vendor.address.street, line2: vendor.address.barangay, city: vendor.address.municipality, province: vendor.address.province, region: vendor.address.region, location: vendor.address.location, zip: vendor.address.zip } },
				contacts: { name: vendor.contactPerson, email: vendor.email, phone: vendor.mobile },
				// 2303-derived
				tin: vendor.tin,
				rdoCode: vendor.rdoCode,
				taxTypes: vendor.taxTypes,
				lineOfBusiness: vendor.lineOfBusiness,
				dateOfRegistration: vendor.dateOfRegistration,
				// Other details
				website: vendor.website,
				bankName: vendor.bankName,
				bankAccountNumber: vendor.bankAccountNumber,
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
			{/* Welcome Walkthrough Dialog */}
			<Dialog open={showWelcome} onOpenChange={(open) => {
				setShowWelcome(open);
				if (!open) {
					localStorage.setItem('dentpal_vendor_welcome_seen', 'true');
				}
			}}>
				<DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle className="text-xl flex items-center gap-2">
							<span className="text-2xl">👋</span> Welcome to Vendor Enrollment!
						</DialogTitle>
						<DialogDescription className="text-base mt-2">
							Let's get your seller account set up in a few easy steps.
						</DialogDescription>
					</DialogHeader>
					
					<div className="space-y-6 py-4">
						{/* Step by step guide */}
						<div className="space-y-4">
							<div className="flex gap-4">
								<div className="flex-shrink-0 w-10 h-10 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-semibold text-lg">1</div>
								<div>
									<h3 className="font-semibold text-gray-900 mb-1">Upload BIR Form 2303</h3>
									<p className="text-sm text-gray-600">Upload your BIR Certificate of Registration (Form 2303). We'll automatically extract your TIN, RDO code, tax types, and other details to save you time.</p>
								</div>
							</div>
							
							<div className="flex gap-4">
								<div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-semibold text-lg">2</div>
								<div>
									<h3 className="font-semibold text-gray-900 mb-1">Complete Company Information</h3>
									<p className="text-sm text-gray-600">Fill in your company name, store name, and complete address details to proceed to the next step.</p>
								</div>
							</div>
							
							<div className="flex gap-4">
								<div className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-semibold text-lg">3</div>
								<div>
									<h3 className="font-semibold text-gray-900 mb-1">Provide Contact & Address Details</h3>
									<p className="text-sm text-gray-600">Enter your contact person, phone number, email, and complete business address. We'll help you verify it on the map.</p>
								</div>
							</div>
							
							<div className="flex gap-4">
								<div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-semibold text-lg">4</div>
								<div>
									<h3 className="font-semibold text-gray-900 mb-1">Upload Required Documents</h3>
									<p className="text-sm text-gray-600">Submit SEC/DTI certificate, FDA/LTO permit, product catalogue, and warranty policy. These documents help us verify your business.</p>
								</div>
							</div>
							
							<div className="flex gap-4">
								<div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-semibold text-lg">5</div>
								<div>
									<h3 className="font-semibold text-gray-900 mb-1">Review & Submit</h3>
									<p className="text-sm text-gray-600">Review all your information, then submit for approval. Once approved, you'll have full access to all seller features!</p>
								</div>
							</div>
						</div>
						
						{/* Important notes */}
						<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
							<div className="flex gap-3">
								<div className="text-blue-600 text-xl">💡</div>
								<div>
									<h4 className="font-semibold text-blue-900 mb-1">Helpful Tips</h4>
									<ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
										<li>Have your BIR Form 2303 ready (PDF or image)</li>
										<li>Prepare your business documents (SEC/DTI, FDA/LTO)</li>
										<li>The process takes about 5-10 minutes to complete</li>
										<li>You can save your progress and come back later</li>
									</ul>
								</div>
							</div>
						</div>
					</div>
					
					<DialogFooter className="flex gap-2">
						<button 
							onClick={() => {
								localStorage.setItem('dentpal_vendor_welcome_seen', 'true');
								setShowWelcome(false);
							}}
							className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
						>
							I'll do this later
						</button>
						<button 
							onClick={() => {
								localStorage.setItem('dentpal_vendor_welcome_seen', 'true');
								setShowWelcome(false);
								if (!vendorProfileComplete) {
									setIsEditing(true);
								}
							}}
							className="px-4 py-2 text-sm rounded-lg bg-teal-600 text-white hover:bg-teal-700 font-medium"
						>
							Let's Get Started! 🚀
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			
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
					{/* Progress banner with helpful context */}
					{!vendorProfileComplete && (
						<div className="bg-gradient-to-r from-teal-50 to-blue-50 border border-teal-200 rounded-lg p-4">
							<div className="flex items-start gap-3">
								<div className="text-2xl">📝</div>
								<div className="flex-1">
									<h3 className="font-semibold text-gray-900 mb-1">Complete Your Vendor Profile</h3>
									<p className="text-sm text-gray-700 mb-2">
										You're on <strong>Step {step + 1} of {STEPS.length}</strong>: {STEPS[step]}
									</p>
									<div className="w-full bg-gray-200 rounded-full h-2">
										<div 
											className="bg-teal-600 h-2 rounded-full transition-all duration-300" 
											style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
										/>
									</div>
								</div>
							</div>
						</div>
					)}
					
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
								{/* Step helper message */}
								<div className="bg-blue-50 border-l-4 border-blue-400 p-3 mb-3">
									<div className="flex items-start gap-2">
										<span className="text-blue-600 text-lg">💡</span>
										<div>
											<p className="text-sm font-medium text-blue-900">Quick Tip</p>
											<p className="text-xs text-blue-800 mt-1">Upload your BIR Form 2303 (Certificate of Registration). Our system will automatically read and fill in your TIN, RDO code, and other tax information to save you time!</p>
										</div>
									</div>
								</div>
								
								<div className="flex items-center justify-between">
									<div>
										<div className="text-sm font-medium text-gray-900">Step 1: Upload & Review BIR 2303</div>
										<p className="text-xs text-gray-600">Upload a PDF or image. We will auto-extract your details for review. If extraction fails, you can manually enter them.</p>
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
										{!vendor.requirements.bir2303 && existingDocs.bir && (
											<span className="text-xs text-teal-700 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-teal-600"/> Previously uploaded</span>
										)}
										{ocrFailed && (
											<span className="text-xs text-amber-700 inline-flex items-center gap-1">
												<AlertCircle className="w-3 h-3"/> Manual entry required
											</span>
										)}
									</div>
								</div>

								{/* Review suggestions (merged into Step 1) */}
								{suggestions && (
									<div className="mt-4">
										<div className="flex items-center justify-between mb-2">
											<div className="text-sm font-medium text-gray-900">
												{Object.keys(suggestions.values).length > 0 ? 'Review extracted details' : 'Manual Entry Required'}
											</div>
											<button type="button" className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-white" onClick={()=> setSuggestionsOpen(s=>!s)}>{suggestionsOpen ? 'Hide' : 'Show'}</button>
										</div>
										{suggestionsOpen && (
											<>
												{/* Show message when OCR failed or no data extracted */}
												{Object.keys(suggestions.values).length === 0 && (
													<div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
														<div className="flex gap-2">
															<AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
															<div className="text-xs text-amber-800">
																<p className="font-medium mb-1">Unable to extract data from document</p>
																<p>The system couldn't read information from your uploaded BIR 2303. This can happen with low-quality scans or certain image formats. <strong>You can proceed by manually entering the details below.</strong></p>
															</div>
														</div>
													</div>
												)}
												
												{/* Show missing fields warning for Step 0 when user attempts to proceed */}
												{step === 0 && attemptedNext && !canProceed && (
													<div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
														<div className="flex items-start justify-between gap-3">
															<div className="flex gap-2 flex-1">
																<AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
																<div className="flex-1">
																	<p className="text-xs font-medium text-red-900 mb-1">Please complete all required fields:</p>
																	<ul className="text-xs text-red-800 list-disc list-inside space-y-0.5">
																		{getMissingFields().map((field, idx) => (
																			<li key={idx}>{field}</li>
																		))}
																	</ul>
																</div>
															</div>
															<button
																type="button"
																onClick={() => setAttemptedNext(false)}
																className="text-red-600 hover:text-red-800 flex-shrink-0"
																aria-label="Dismiss"
															>
																<X className="w-4 h-4" />
															</button>
														</div>
													</div>
												)}
												
												<div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
												{/* TIN */}
												<div>
													<label className="block text-xs font-medium text-gray-600 mb-1">
														TIN (from 2303) <span className="text-red-500">*</span>
														<span className="ml-1 text-[10px] text-gray-500">{Math.round((suggestions.confidence.tin||0)*100)}%</span>
													</label>
													<input ref={tinInputRef} disabled={!isEditing} value={formattedTin} onChange={onTinChange} inputMode="numeric" className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
													{errors.tin && <p className="mt-1 text-xs text-red-600">{errors.tin}</p>}
												</div>
												{/* Company Name */}
												<div>
													<label className="block text-xs font-medium text-gray-600 mb-1">
														Registered/Trade Name <span className="text-red-500">*</span>
														<span className="ml-1 text-[10px] text-gray-500">{Math.round((suggestions.confidence.companyName||0)*100)}%</span>
													</label>
													<input ref={companyNameRef} disabled={!isEditing} value={vendor.companyName} onChange={(e)=> setField('companyName', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
												</div>
												{/* Address quick fill */}
												<div className="md:col-span-2">
													<label className="block text-xs font-medium text-gray-600 mb-1">
														Address <span className="text-red-500">*</span>
														{suggestions.confidence.address && suggestions.confidence.address > 0 && (
															<span className="ml-1 text-[10px] text-gray-500">{Math.round(suggestions.confidence.address * 100)}%</span>
														)}
													</label>
													<div className="grid grid-cols-1 md:grid-cols-5 gap-2">
														<input disabled={!isEditing} placeholder="Street *" value={vendor.address.street} onChange={(e)=> setAddressField('street', e.target.value)} className="md:col-span-2 w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
														<input disabled={!isEditing} placeholder="Barangay" value={vendor.address.barangay} onChange={(e)=> setAddressField('barangay', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
														<input disabled={!isEditing} placeholder="Municipality/City *" value={vendor.address.municipality} onChange={(e)=> setAddressField('municipality', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
														<input disabled={!isEditing} placeholder="Province *" value={vendor.address.province} onChange={(e)=> setAddressField('province', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
														<input disabled={!isEditing} placeholder="ZIP *" value={vendor.address.zip} onChange={onZipChange} inputMode="numeric" maxLength={4} className={`w-full text-sm p-2 border rounded-lg disabled:bg-gray-50 ${errors.zip ? 'border-red-300' : 'border-gray-200'}`} />
													</div>
													{errors.zip && <p className="mt-1 text-xs text-red-600">{errors.zip}</p>}
												</div>
												{/* RDO Code */}
												<div>
													<label className="block text-xs font-medium text-gray-600 mb-1">
														RDO Code <span className="text-red-500">*</span>
														{suggestions.confidence.rdoCode && suggestions.confidence.rdoCode > 0 && (
															<span className="ml-1 text-[10px] text-gray-500">{Math.round(suggestions.confidence.rdoCode * 100)}%</span>
														)}
													</label>
													<input disabled={!isEditing} value={vendor.rdoCode} onChange={(e)=> setField('rdoCode', e.target.value.replace(/\D/g,''))} inputMode="numeric" className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
												</div>
												{/* Line of Business */}
												<div>
													<label className="block text-xs font-medium text-gray-600 mb-1">
														Line of Business <span className="text-red-500">*</span>
														{suggestions.confidence.lineOfBusiness && suggestions.confidence.lineOfBusiness > 0 && (
															<span className="ml-1 text-[10px] text-gray-500">{Math.round(suggestions.confidence.lineOfBusiness * 100)}%</span>
														)}
													</label>
													<input disabled={!isEditing} value={vendor.lineOfBusiness} onChange={(e)=> setField('lineOfBusiness', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
												</div>
												{/* Date of Registration */}
												<div>
													<label className="block text-xs font-medium text-gray-600 mb-1">
														Date of Registration <span className="text-red-500">*</span>
														{suggestions.confidence.dateOfRegistration && suggestions.confidence.dateOfRegistration > 0 && (
															<span className="ml-1 text-[10px] text-gray-500">{Math.round(suggestions.confidence.dateOfRegistration * 100)}%</span>
														)}
													</label>
													<input disabled={!isEditing} type="date" value={/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(vendor.dateOfRegistration) ? vendor.dateOfRegistration : ''} onChange={(e)=> { setField('dateOfRegistration', e.target.value); setErrors(prev=>({ ...prev, regDate: validateRegDate(e.target.value) })); }} className={`w-full text-sm p-2 border rounded-lg disabled:bg-gray-50 ${errors.regDate ? 'border-red-300' : 'border-gray-200'}`} />
													{/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(vendor.dateOfRegistration) ? null : (vendor.dateOfRegistration && (
														<p className="mt-1 text-xs text-amber-700">Unrecognized date format from document: {vendor.dateOfRegistration}. Please correct.</p>
													))}
													{errors.regDate && <p className="mt-1 text-xs text-red-600">{errors.regDate}</p>}
												</div>
												{/* Tax Types */}
												<div className="md:col-span-2">
													<label className="block text-xs font-medium text-gray-600 mb-1">
														Tax Types <span className="text-red-500">*</span>
														{suggestions.confidence.taxTypes && suggestions.confidence.taxTypes > 0 && (
															<span className="ml-1 text-[10px] text-gray-500">{Math.round(suggestions.confidence.taxTypes * 100)}%</span>
														)}
													</label>
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
													<div className="text-[11px] text-gray-500">
														Source: {suggestions.textSource === 'unknown' ? 'Manual Input' : suggestions.textSource.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
													</div>
													<label className="inline-flex items-center gap-2 text-xs text-gray-700">
														<input type="checkbox" className="h-4 w-4" checked={userConfirmed} onChange={(e)=> setUserConfirmed(e.target.checked)} />
														<span>I confirm that the details provided are correct.</span>
													</label>
												</div>
											</div>
											</>
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
									{/* Step helper message */}
									<div className="bg-purple-50 border-l-4 border-purple-400 p-3 mb-3">
										<div className="flex items-start gap-2">
											<span className="text-purple-600 text-lg">🏢</span>
											<div>
												<p className="text-sm font-medium text-purple-900">Company Information</p>
												<p className="text-xs text-purple-800 mt-1">Provide your business details and complete address. Make sure your company name matches your official registration documents.</p>
											</div>
										</div>
									</div>
									
									{/* Show missing fields warning for Step 1 when user attempts to proceed */}
									{attemptedNext && !canProceed && (
										<div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
											<div className="flex items-start justify-between gap-3">
												<div className="flex gap-2 flex-1">
													<AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
													<div className="flex-1">
														<p className="text-xs font-medium text-red-900 mb-1">Please complete all required fields:</p>
														<ul className="text-xs text-red-800 list-disc list-inside space-y-0.5">
															{getMissingFields().map((field, idx) => (
																<li key={idx}>{field}</li>
															))}
														</ul>
													</div>
												</div>
												<button
													type="button"
													onClick={() => setAttemptedNext(false)}
													className="text-red-600 hover:text-red-800 flex-shrink-0"
													aria-label="Dismiss"
												>
													<X className="w-4 h-4" />
												</button>
											</div>
										</div>
									)}
									
									{/* Company Info & Address */}
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Company Name <span className="text-red-500">*</span>
											</label>
											<input ref={companyNameRef} disabled={!isEditing} value={vendor.companyName} onChange={(e)=> setField('companyName', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
										<div className="md:col-span-2">
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Store Name <span className="text-red-500">*</span>
											</label>
											<input ref={storeNameRef} disabled={!isEditing} value={vendor.storeName} onChange={(e)=> setField('storeName', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
										<div className="md:col-span-2">
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Location <span className="text-red-500">*</span>
											</label>
											<select disabled={!isEditing} value={location} onChange={(e)=> onLocationSelect(e.target.value as LocationGroup)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50">
												<option value="">Select location</option>
												<option value="NCR">NCR</option>
												<option value="Luzon">Luzon</option>
												<option value="Visayas">Visayas</option>
												<option value="Mindanao">Mindanao</option>
											</select>
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Region</label>
											<select disabled={!isEditing || !location || location === 'NCR'} value={selectedRegion} onChange={(e)=> onRegionSelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50">
												<option value="">Select region</option>
												{regions
													.filter(r => location && regionToLocation(r.name) === location)
													.map(r => (<option key={r.code} value={r.code}>{r.name}</option>))}
											</select>
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Province <span className="text-red-500">*</span>
											</label>
											{location === 'NCR' ? (
												<input disabled value="Metro Manila" className="w-full text-sm p-2 border border-gray-200 rounded-lg bg-gray-50" />
											) : (
												<select ref={provinceRef} disabled={!isEditing || !selectedRegion} value={selectedProvince} onChange={(e)=> onProvinceSelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50">
													<option value="">Select province</option>
													{provinces.map(p => (<option key={p.code} value={p.code}>{p.name}</option>))}
												</select>
											)}
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Municipality / City <span className="text-red-500">*</span>
											</label>
											<select ref={cityRef} disabled={!isEditing || (location !== 'NCR' && !selectedProvince)} value={selectedCity} onChange={(e)=> onCitySelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50">
												<option value="">Select city/municipality</option>
												{cities.map(c => (<option key={c.code} value={c.code}>{c.name}</option>))}
											</select>
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Barangay <span className="text-red-500">*</span>
											</label>
											<select ref={barangayRef} disabled={!isEditing || !selectedCity} value={selectedBarangay} onChange={(e)=> onBarangaySelect(e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50">
												<option value="">Select barangay</option>
												{barangays.map(b => (<option key={b.code} value={b.code}>{b.name}</option>))}
											</select>
										</div>
										<div className="md:col-span-2">
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Street <span className="text-red-500">*</span>
											</label>
											<input ref={streetRef} disabled={!isEditing} value={vendor.address.street} onChange={(e)=> setAddressField('street', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">
												ZIP Code <span className="text-red-500">*</span>
											</label>
											<input ref={zipRef} disabled={!isEditing} value={vendor.address.zip} onChange={onZipChange} inputMode="numeric" maxLength={4} placeholder="e.g. 1000" className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
											{zipLoading && <p className="mt-1 text-xs text-gray-500">Auto-filling ZIP…</p>}
											{errors.zip && <p className="mt-1 text-xs text-red-600">{errors.zip}</p>}
										</div>
									</div>
								</>
							)}

							{/* Step 3 (index 2): Contacts & Documents */}
							{step === 2 && (
								<>
									{/* Step helper message */}
									<div className="bg-amber-50 border-l-4 border-amber-400 p-3 mb-3">
										<div className="flex items-start gap-2">
											<span className="text-amber-600 text-lg">📞</span>
											<div>
												<p className="text-sm font-medium text-amber-900">Contact & Documentation</p>
												<p className="text-xs text-amber-800 mt-1">Provide accurate contact information and upload all required business documents. These will be used to verify your business and communicate with you about orders.</p>
											</div>
										</div>
									</div>
									
									{/* Show missing fields warning for Step 2 when user attempts to proceed */}
									{attemptedNext && !canProceed && (
										<div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
											<div className="flex items-start justify-between gap-3">
												<div className="flex gap-2 flex-1">
													<AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
													<div className="flex-1">
														<p className="text-xs font-medium text-red-900 mb-1">Please complete all required fields:</p>
														<ul className="text-xs text-red-800 list-disc list-inside space-y-0.5">
															{getMissingFields().map((field, idx) => (
																<li key={idx}>{field}</li>
															))}
														</ul>
													</div>
												</div>
												<button
													type="button"
													onClick={() => setAttemptedNext(false)}
													className="text-red-600 hover:text-red-800 flex-shrink-0"
													aria-label="Dismiss"
												>
													<X className="w-4 h-4" />
												</button>
											</div>
										</div>
									)}
									
									{/* Contacts */}
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
<div>
    <label className="block text-xs font-medium text-gray-600 mb-1">Customer Service Contact Person <span className="text-red-500">*</span></label>
    <input disabled={!isEditing} value={vendor.contactPerson} onChange={(e)=> setField('contactPerson', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Mobile No <span className="text-red-500">*</span>
											</label>
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
										{/* <div>
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Email Address <span className="text-red-500">*</span>
											</label>
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
										</div> */}
										{/* <div>
											<label className="block text-xs font-medium text-gray-600 mb-1">Website (Optional)</label>
											<input ref={websiteRef} disabled={!isEditing} value={vendor.website} onChange={(e)=> setField('website', e.target.value)} placeholder="https://" className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div> */}
									</div>

									{/* Documents & Banking */}
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Bank Name <span className="text-red-500">*</span>
											</label>
											<input disabled={!isEditing} value={vendor.bankName} onChange={(e)=> setField('bankName', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" placeholder="e.g., BDO, BPI, Metrobank" />
										</div>
										<div>
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Bank Account Number <span className="text-red-500">*</span>
											</label>
											<input disabled={!isEditing} value={vendor.bankAccountNumber} onChange={(e)=> setField('bankAccountNumber', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" placeholder="Account number" />
										</div>
										<div className="md:col-span-2">
											<label className="block text-xs font-medium text-gray-600 mb-1">
												Bank Account Name <span className="text-red-500">*</span>
											</label>
											<input ref={bankBranchRef} disabled={!isEditing} value={vendor.bankBranchAddress} onChange={(e)=> setField('bankBranchAddress', e.target.value)} className="w-full text-sm p-2 border border-gray-200 rounded-lg disabled:bg-gray-50" />
										</div>
									</div>

									<div>
										<label className="block text-xs font-medium text-gray-600 mb-2">
											Requirements <span className="text-red-500">*</span>
										</label>
										<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
											{[
												{ key: 'secOrDti', label: 'SEC Certificate or DTI Registration *' },
												{ key: 'fdaLto', label: 'FDA LTO Medical Device *' },
											].map(({ key, label }) => (
												<div key={key} className="p-3 border border-gray-200 rounded-lg">
													<div className="text-xs text-gray-700 mb-2">{label}</div>
													<div className="flex items-center justify-between gap-2">
														<input disabled={!isEditing} type="file" accept="application/pdf,image/*" onChange={(e)=> setReqFile(key as any, e.target.files?.[0] || null)} />
														<div className="text-[11px] text-gray-600 inline-flex items-center gap-1">
															{(vendor.requirements as any)[key] ? <><CheckCircle2 className="w-3 h-3 text-teal-600" /> Uploaded</> : 
															(existingDocs as any)[key] ? <><CheckCircle2 className="w-3 h-3 text-teal-600" /> Previously uploaded</> :
															<><AlertCircle className="w-3 h-3 text-amber-600" /> Required</>}
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
					<div className="sticky bottom-0 bg-white/80 backdrop-blur border-t border-gray-200 px-4 py-3 rounded-b-lg">
						<div className="flex items-center justify-between">
							<span className="text-xs text-gray-600">Step {step + 1} of {STEPS.length}</span>
							<div className="flex items-center gap-2">
								<button type="button" onClick={back} disabled={step === 0} className="px-3 py-2 text-xs rounded-lg border border-gray-200 disabled:opacity-40">Back</button>
								{step < STEPS.length - 1 ? (
									<button type="button" onClick={next} className="px-3 py-2 text-xs rounded-lg bg-teal-600 text-white hover:bg-teal-700">Next</button>
								) : (
									<button
										onClick={() => {
											setAttemptedNext(true);
											if (canProceed) setReviewOpen(true);
										}}
										className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700"
									>
										<Upload className="w-4 h-4" /> Review & Submit
									</button>
								)}
							</div>
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
									<div className="p-3 border border-gray-200 rounded-lg">
										<div className="text-xs text-gray-500">Bank Name</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm text-gray-900">{vendor.bankName || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(2)}>Edit</button>
										</div>
									</div>
									<div className="p-3 border border-gray-200 rounded-lg">
										<div className="text-xs text-gray-500">Bank Account Number</div>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm text-gray-900">{vendor.bankAccountNumber || '—'}</div>
											<button className="text-xs text-teal-700 hover:underline" onClick={() => jumpAndFocus(2)}>Edit</button>
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

					{/* Profile Image Upload Success Dialog */}
					<Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
						<DialogContent className="sm:max-w-md">
							<div className="flex flex-col items-center justify-center py-6">
								<div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
									<CheckCircle2 className="w-10 h-10 text-green-600" />
								</div>
								<h2 className="text-xl font-semibold text-gray-900 mb-2">Submit Profile Successful</h2>
								<p className="text-sm text-gray-600 text-center">Your profile image has been updated successfully.</p>
								<button
									onClick={() => setShowSuccessDialog(false)}
									className="mt-6 px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition"
								>
									OK
								</button>
							</div>
						</DialogContent>
					</Dialog>
				</>
			)}
		</div>
	);
}

export default SellerProfileTab;
