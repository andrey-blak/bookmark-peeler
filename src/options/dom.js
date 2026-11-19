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

/**
 * Makes a text box grow with its content, from `minRows` to `maxRows` lines, then scroll. It can still be resized by hand.
 * Returns a function that fits the box again: call it after the text is set, and when the box becomes visible,
 * since a box that is not shown cannot be measured.
 */
export function autosize(textarea, { minRows = 2, maxRows = 10 } = {}) {
  function fit() {
    if (!textarea.offsetParent) return;

    // The heights of the shortest and the longest box are measured with the rows attribute, so they match the font.
    textarea.style.height = "";
    textarea.rows = minRows;
    const min = textarea.offsetHeight;
    textarea.rows = maxRows;
    const max = textarea.offsetHeight;
    textarea.rows = minRows;

    textarea.style.minHeight = `${min}px`;
    textarea.style.height = "auto";
    const wanted = textarea.scrollHeight + (textarea.offsetHeight - textarea.clientHeight);
    textarea.style.height = `${Math.min(Math.max(wanted, min), max)}px`;
  }

  textarea.addEventListener("input", fit);
  return fit;
}
