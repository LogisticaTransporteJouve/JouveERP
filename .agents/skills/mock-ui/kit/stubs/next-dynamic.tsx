// next/dynamic for the mock: lazily loaded pieces (the global search dialog) render nothing.
export default function dynamic() {
  return function Dynamic() {
    return null;
  };
}
