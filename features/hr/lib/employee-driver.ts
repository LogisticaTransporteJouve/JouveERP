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

export type EmployeeDriverInput = {
  employeeId: string;
  /** Kept equal to the employee's legal name. */
  fullName: string;
  cuil: string | null;
  isDriver: boolean;
  licenseNumber?: string | null;
  licenseCategory?: string | null;
  phone?: string | null;
  userId: string;
};

/**
 * Reads the employee's driver record. Service client: callers gate with
 * hr:read first, and the drivers RLS leaves finance (who manages HR) out.
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

/**
 * Keeps the employee's driver record in step with the employee: a driver
 * position creates or updates it (name from the employee), any other position
 * deactivates it (trips keep their history). Callers gate with hr:write.
 */
export async function syncEmployeeDriver(
  input: EmployeeDriverInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getServiceClient();
  let current: EmployeeDriver | null;
  try {
    current = await readEmployeeDriver(input.employeeId);
  } catch {
    return { ok: false, error: "No se pudo leer el chofer del empleado." };
  }

  if (!input.isDriver) {
    if (!current || !current.is_active) return { ok: true };
    const { error } = await supabase
      .from("drivers")
      .update({ is_active: false, full_name: input.fullName })
      .eq("id", current.id);
    return error
      ? { ok: false, error: "No se pudo actualizar el chofer del empleado." }
      : { ok: true };
  }

  const fields = {
    full_name: input.fullName,
    cuit: input.cuil,
    is_active: true,
    ...(input.licenseNumber !== undefined && {
      license_number: input.licenseNumber,
    }),
    ...(input.licenseCategory !== undefined && {
      license_category: input.licenseCategory,
    }),
    ...(input.phone !== undefined && { phone: input.phone }),
  };

  const { error } = current
    ? await supabase.from("drivers").update(fields).eq("id", current.id)
    : await supabase.from("drivers").insert({
        ...fields,
        employee_id: input.employeeId,
        created_by: input.userId,
      });
  return error
    ? { ok: false, error: "No se pudo guardar el chofer del empleado." }
    : { ok: true };
}

/** Deactivates the employee's driver record (terminated employee). */
export async function deactivateEmployeeDriver(
  employeeId: string,
): Promise<{ ok: boolean }> {
  const { error } = await getServiceClient()
    .from("drivers")
    .update({ is_active: false })
    .eq("employee_id", employeeId)
    .eq("is_active", true);
  return { ok: !error };
}
