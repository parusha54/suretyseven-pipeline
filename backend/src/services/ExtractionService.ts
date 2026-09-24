/**
 * Open-Closed Principle (OCP) Applied:
 * We define an interface for Document Processing.
 * The system is OPEN for extension (we can easily add RealAiProcessor later)
 * but CLOSED for modification (we don't need to change the Worker's code to swap processors).
 */

export interface IDocumentProcessor {
  process(fileHash: string): Promise<{ success: boolean; data?: any; error?: string; isTransient?: boolean }>;
}

export class MockDocumentProcessor implements IDocumentProcessor {
  async process(fileHash: string): Promise<{ success: boolean; data?: any; error?: string; isTransient?: boolean }> {
    // Simulate network/processing delay (2-4 seconds)
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));

    const rand = Math.random();

    // 10% chance of TIMEOUT (Transient - Should Retry)
    if (rand < 0.1) {
      return { success: false, error: 'PROCESSOR_TIMEOUT', isTransient: true };
    }

    // 10% chance of ERROR (Transient - Should Retry)
    if (rand < 0.2) {
      return { success: false, error: 'AI_SERVICE_UNAVAILABLE', isTransient: true };
    }

    // 10% chance of INVALID_RESULT (Permanent - Should NOT Retry)
    // We intentionally return bad data to test our Zod validation logic
    if (rand < 0.3) {
      return {
        success: true,
        data: {
          companyName: "", // Violates required
          registrationNumber: "U12345DL",
          annualRevenue: -50000, // Violates >= 0
          documentDate: "not-a-date" // Violates date parsing
        }
      };
    }

    // 70% chance of SUCCESS (Valid Extracted Data)
    return {
      success: true,
      data: {
        companyName: "SuretySeven Demo Corp",
        registrationNumber: "U12345DL2024PTC123456",
        address: "123 Tech Lane, Innovation City",
        annualRevenue: 50000000,
        documentDate: new Date().toISOString().split('T')[0]
      }
    };
  }
}
