import { z } from 'zod';

/**
 * Validates the fields returned by the document processor before persistence.
 */
export const ExtractedDataSchema = z.object({
  companyName: z.string().min(1, "companyName is required"),
  registrationNumber: z.string().min(1, "registrationNumber is required"),
  address: z.string().optional(),
  annualRevenue: z.number().min(0, "annualRevenue must be >= 0"),
  documentDate: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "documentDate must be a valid date string",
  })
});

export type ExtractedData = z.infer<typeof ExtractedDataSchema>;
