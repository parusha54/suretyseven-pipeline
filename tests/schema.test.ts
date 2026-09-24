import { ExtractedDataSchema } from '../backend/src/schema';

describe('Unit Tests: AI Output Validation (ExtractedDataSchema)', () => {

  it('1. Should successfully validate perfectly clean AI output', () => {
    const validData = {
      companyName: 'ABC Construction Pvt Ltd',
      registrationNumber: 'U12345DL2020PTC123456',
      address: 'New Delhi',
      annualRevenue: 12500000,
      documentDate: '2026-08-15'
    };
    const result = ExtractedDataSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('2. Should fail validation if required fields (companyName) are missing', () => {
    const missingData = {
      registrationNumber: 'U12345',
      annualRevenue: 50000
    };
    const result = ExtractedDataSchema.safeParse(missingData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('Required');
    }
  });

  it('3. Should fail validation if annualRevenue is negative', () => {
    const negativeRevenueData = {
      companyName: 'Acme Corp',
      registrationNumber: '12345',
      annualRevenue: -100 // Invalid!
    };
    const result = ExtractedDataSchema.safeParse(negativeRevenueData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('must be >= 0');
    }
  });

  it('4. Should pass validation with edge-case valid data (e.g., 0 revenue)', () => {
    // Testing boundary conditions (revenue = 0)
    const validMinimalData = {
      companyName: 'Minimal Corp',
      registrationNumber: '999',
      annualRevenue: 0, // 0 is exactly on the boundary of >= 0
      documentDate: '2026-01-01'
    };
    const result = ExtractedDataSchema.safeParse(validMinimalData);
    expect(result.success).toBe(true);
  });
});
