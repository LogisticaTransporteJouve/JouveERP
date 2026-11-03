export const cookies = async () => ({ get: () => undefined, getAll: () => [] });
export const headers = async () => new Headers();
export const revalidatePath = () => {};
export const revalidateTag = () => {};
export const unstable_cache = (f: any) => f;
export default {};
