import BaseIcon from "../components/Icon";
export function Icon({ name, ...props }) {
  return <BaseIcon name={name === "screen" ? "monitor" : name} {...props} />;
}
