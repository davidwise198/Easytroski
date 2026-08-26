// ---------------------------------------------------------------------------
// Input validation & sanitization for EasyTroski
// ---------------------------------------------------------------------------

/**
 * Trim, collapse whitespace, and strip potentially dangerous characters.
 * Does NOT HTML-encode (React handles that); focuses on data hygiene.
 */
export function sanitizeInput(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ") // collapse internal whitespace
    .replace(/[<>"'`;\\]/g, ""); // strip characters often used in injection
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function validateEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return "Email address is required.";
  if (trimmed.length > 254) return "Email address is too long.";
  if (!EMAIL_REGEX.test(trimmed)) return "Please enter a valid email address.";
  return null;
}

// ---------------------------------------------------------------------------
// Phone (Ghana-focused + international fallback)
// ---------------------------------------------------------------------------

/**
 * Accepts:
 *   - Ghanaian mobile: 0XXXXXXXXX or +233XXXXXXXXX (10 / 12 digits)
 *   - International: +<7-15 digits>
 */
export function validatePhone(phone: string): string | null {
  const raw = phone.replace(/[\s\-()]/g, "");
  if (!raw) return "Phone number is required.";

  // Ghana local format: 0XXXXXXXXX (10 digits)
  if (/^0\d{9}$/.test(raw)) return null;

  // Ghana international: +233XXXXXXXXX
  if (/^\+233\d{9}$/.test(raw)) return null;

  // Generic international: +<7-15 digits>
  if (/^\+\d{7,15}$/.test(raw)) return null;

  return "Please enter a valid phone number (e.g. 024XXXXXXX or +233XXXXXXXXX).";
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export function validatePassword(password: string): string | null {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 128) return "Password is too long.";
  if (!/[A-Z]/.test(password))
    return "Password must contain at least one uppercase letter.";
  if (!/[a-z]/.test(password))
    return "Password must contain at least one lowercase letter.";
  if (!/[0-9]/.test(password))
    return "Password must contain at least one number.";
  return null;
}

export function validatePasswordMatch(
  password: string,
  confirm: string
): string | null {
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

// ---------------------------------------------------------------------------
// Full name
// ---------------------------------------------------------------------------

export function validateFullName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Full name is required.";
  if (trimmed.length < 2) return "Name must be at least 2 characters.";
  if (trimmed.length > 100) return "Name is too long.";
  // Allow letters, spaces, hyphens, apostrophes (handles names like O'Brien, Kofi-Mensah)
  if (!/^[a-zA-Z\s'-]+$/.test(trimmed))
    return "Name can only contain letters, spaces, hyphens, and apostrophes.";
  return null;
}

// ---------------------------------------------------------------------------
// Vehicle registration number (Ghana)
// ---------------------------------------------------------------------------

export function validateVehicleReg(reg: string): string | null {
  const trimmed = reg.trim().toUpperCase();
  if (!trimmed) return "Vehicle registration number is required.";
  // Ghana format: GR-1234 or similar (2 letters, hyphen, 3-4 digits, optional suffix)
  if (!/^[A-Z]{2}-?\d{3,4}[A-Z]?$/.test(trimmed)) {
    // Be lenient — accept any alphanumeric 4-12 char string as custom format
    if (!/^[A-Z0-9\-]{4,12}$/.test(trimmed)) {
      return "Please enter a valid registration number (e.g. GR-1234).";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Seating capacity
// ---------------------------------------------------------------------------

export function validateSeatingCapacity(cap: string): string | null {
  const num = parseInt(cap, 10);
  if (isNaN(num) || num.toString() !== cap.trim())
    return "Please enter a valid number.";
  if (num < 1) return "Capacity must be at least 1.";
  if (num > 30) return "Capacity cannot exceed 30.";
  return null;
}

// ---------------------------------------------------------------------------
// Driver licence number
// ---------------------------------------------------------------------------

export function validateLicenceNumber(licence: string): string | null {
  const trimmed = licence.trim();
  if (!trimmed) return "Driver licence number is required.";
  if (trimmed.length < 5) return "Licence number seems too short.";
  if (trimmed.length > 30) return "Licence number seems too long.";
  return null;
}

// ---------------------------------------------------------------------------
// Generic required field
// ---------------------------------------------------------------------------

export function validateRequired(
  value: string,
  fieldName: string
): string | null {
  if (!value.trim()) return `${fieldName} is required.`;
  return null;
}

// ---------------------------------------------------------------------------
// Helper: validate a whole registration form
// ---------------------------------------------------------------------------

export type RegistrationValidationResult = {
  valid: boolean;
  errors: Record<string, string>;
};

export function validateRegistrationForm(fields: {
  fullName: string;
  phoneNumber: string;
  email: string;
  password: string;
  confirmPassword: string;
  isDriver?: boolean;
  licenceNumber?: string;
  vehicleReg?: string;
  vehicleColor?: string;
  seatingCapacity?: string;
  agreeToTerms: boolean;
}): RegistrationValidationResult {
  const errors: Record<string, string> = {};

  const fullNameErr = validateFullName(fields.fullName);
  if (fullNameErr) errors.fullName = fullNameErr;

  const phoneErr = validatePhone(fields.phoneNumber);
  if (phoneErr) errors.phoneNumber = phoneErr;

  const emailErr = validateEmail(fields.email);
  if (emailErr) errors.email = emailErr;

  const pwErr = validatePassword(fields.password);
  if (pwErr) errors.password = pwErr;

  const matchErr = validatePasswordMatch(
    fields.password,
    fields.confirmPassword
  );
  if (matchErr) errors.confirmPassword = matchErr;

  if (!fields.agreeToTerms) {
    errors.terms = "Please accept the terms to continue.";
  }

  if (fields.isDriver) {
    const licenceErr = validateLicenceNumber(fields.licenceNumber ?? "");
    if (licenceErr) errors.licenceNumber = licenceErr;

    const regErr = validateVehicleReg(fields.vehicleReg ?? "");
    if (regErr) errors.vehicleReg = regErr;

    const colorErr = validateRequired(fields.vehicleColor ?? "", "Vehicle colour");
    if (colorErr) errors.vehicleColor = colorErr;

    const capErr = validateSeatingCapacity(fields.seatingCapacity ?? "");
    if (capErr) errors.seatingCapacity = capErr;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
