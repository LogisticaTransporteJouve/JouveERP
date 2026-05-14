"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import { getMyProfileAction } from "../actions/get-my-profile";
import { updateProfileAction } from "../actions/update-profile";
import {
  removeAvatarAction,
  uploadAvatarAction,
} from "../actions/upload-avatar";
import { profileKeys } from "../keys";

export function useMyProfile() {
  return useSuspenseQuery({
    queryKey: profileKeys.me(),
    queryFn: () => runAction(() => getMyProfileAction()),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) => runAction(() => updateProfileAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}

export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return runAction(() => uploadAvatarAction(fd));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}

export function useRemoveAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runAction(() => removeAvatarAction()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: profileKeys.all });
    },
  });
}
