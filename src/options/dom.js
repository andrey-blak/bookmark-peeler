// A tiny helper for building DOM: el("button", { type: "button", className: "x" }, "Text", otherNode).
// `dataset` is an object of data-attributes; role and names with a dash are set as attributes.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === "dataset") Object.assign(node.dataset, value);
    else if (name === "role" || name.includes("-")) node.setAttribute(name, value); // ARIA properties are not reliable in Firefox 112
    else node[name] = value;
  }
  node.append(...children);
  return node;
}
