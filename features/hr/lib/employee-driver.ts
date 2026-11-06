import "server-only";

import { getServiceClient } from "@/lib/supabase/service";

/** The driver data shown and edited on the employee (one driver per employee). */
export type EmployeeDriver = {
  id: string;
  license_number: string | null;
  license_category: string | null;
  phone: string | null;
  is_active: boolean;
};

/**
 * Reads the employee's driver record. Service client: callers gate with
 * hr:read first, and the drivers RLS leaves finance (who manages HR) out.
 * The record is written with the employee, in create_employee,
 * update_employee and terminate_employee.
 */
export async function readEmployeeDriver(
  employeeId: string,
): Promise<EmployeeDriver | null> {
  const { data, error } = await getServiceClient()
    .from("drivers")
    .select("id, license_number, license_category, phone, is_active")
    .eq("employee_id", employeeId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`employee-driver read: ${error.message}`);
  return data;
}
