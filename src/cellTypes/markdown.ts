/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { render, TemplateResult } from "lit";
import mdlib from "markdown-it";

import { BaseCellHandler } from "./base";
import { cellControlsTemplate } from "../components/controls";
import { StarboardTextEditor } from "../components/textEditor";
import { Cell } from "../types";
import { CellElements, CellHandlerAttachParameters, ControlButton, Runtime } from "../types";
import { promiseState } from "./javascript/util";

import { StarboardContentEditor } from "../components/editor/contentEditor";
import { hasParentWithId } from "../components/helpers/dom";
import { getMarkdownItWithDefaultPlugins } from "../components/helpers/markdown";

const mdLoader = getMarkdownItWithDefaultPlugins();
const md = mdLoader.md;
const katexHookPromise = mdLoader.katexLoaded;

async function isKatexAlreadyLoaded() {
  return (await promiseState(katexHookPromise)) === "fulfilled";
}

type EditMode = "wysiwyg" | "code" | "display";
const DEFAULT_EDIT_MODE = "code";

export const MARKDOWN_CELL_TYPE_DEFINITION = {
  name: "Markdown",
  cellType: ["markdown", "md"],
  createHandler: (c: Cell, r: Runtime) => new MarkdownCellHandler(c, r),
};

export class MarkdownCellHandler extends BaseCellHandler {
  private editMode: EditMode = "display";

  private elements!: CellElements;
  private editor: any;

  constructor(cell: Cell, runtime: Runtime) {
    super(cell, runtime);
  }

  private getControls(): TemplateResult {
    let editOrRunButton: ControlButton;

    if (this.editMode === "code") {
      editOrRunButton = {
        icon: "bi bi-type",
        tooltip: "Edit as rich text",
        callback: () => {
          setTimeout(() => this.editor && this.editor.focus());
          this.enterEditMode("wysiwyg");
        },
      };
    } else if (this.editMode === "wysiwyg") {
      editOrRunButton = {
        icon: "bi bi-code-slash",
        tooltip: "Edit markdown source directly",
        callback: () => {
          setTimeout(() => this.editor && this.editor.focus());
          this.enterEditMode("code");
        },
      };
    } else {
      editOrRunButton = {
        icon: "bi-pencil-square",
        tooltip: "Edit Markdown",
        callback: () => {
          this.enterEditMode(DEFAULT_EDIT_MODE);
          setTimeout(() => this.editor && this.editor.focus());
        },
      };
    }

    return cellControlsTemplate({ buttons: [editOrRunButton] });
  }

  attach(params: CellHandlerAttachParameters) {
    this.elements = params.elements;

    if (this.cell.textContent !== "") {
      // Initial render
      this.run();
    }

    const topElement = this.elements.topElement;
    topElement.addEventListener("dblclick", (_event: any) => {
      if (this.editMode === "display") {
        this.enterEditMode(DEFAULT_EDIT_MODE);
      }
    });

    // The cell itself loses focus to somewhere outside of the cell, in that case we just render Markdown itself again.
    this.elements.cell.addEventListener("focusout", (event: FocusEvent) => {
      if (
        this.editMode !== "display" &&
        (!event.relatedTarget || !hasParentWithId(event.relatedTarget as HTMLElement, this.cell.id))
      ) {
        setTimeout(() => {
          // Workaround for some plugins (prosemirror-math) focusing later in the same tick.
          if (!hasParentWithId(document.activeElement, this.cell.id)) {
            this.run();
          }
        }, 0);
      }
    });

    if (this.cell.textContent === "") {
      this.enterEditMode(DEFAULT_EDIT_MODE);
    }
  }

  private setupEditor() {
    const topElement = this.elements.topElement;
    topElement.innerHTML = "";
    if (this.editMode === "code") {
      this.editor = new StarboardTextEditor(this.cell, this.runtime, {
        language: "markdown",
        wordWrap: "on",
      });
    } else {
      this.editor = new StarboardContentEditor(this.cell, this.runtime, {
        editable: () => {
          return this.cell.metadata.properties.locked !== true;
        },
      });

      let previouslyEditable = this.cell.metadata.properties.locked !== true;
      this.runtime.controls.subscribeToCellChanges(this.cell.id, () => {
        if (this.editor instanceof StarboardContentEditor) {
          const editableNow = this.cell.metadata.properties.locked !== true;
          if (previouslyEditable !== editableNow) {
            this.editor.refreshSettings();
            previouslyEditable = editableNow;
          }
        }
      });
    }
    topElement.appendChild(this.editor);
  }

  enterEditMode(mode: EditMode) {
    if (this.editor) {
      this.editor.dispose();
    }

    this.editMode = mode;
    this.setupEditor();
    render(this.getControls(), this.elements.topControlsElement);
  }

  async run() {
    this.editMode = "display";
    const topElement = this.elements.topElement;
    topElement.innerHTML = "";

    const outDiv = document.createElement("div");
    outDiv.classList.add("markdown-body");
    outDiv.innerHTML = md.render(this.cell.textContent);

    // Re-render when katex becomes available
    if (!(await isKatexAlreadyLoaded())) {
      // Possible improvement: we could detect if any latex is present before we load katex
      katexHookPromise.then(() => {
        outDiv.innerHTML = md.render(this.cell.textContent);
      });
    }

    topElement.appendChild(outDiv);

    // This works around a weird situation in which more than one output is present when
    // a cell is marked as run_on_load
    if (topElement.children.length > 1) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      topElement.children.item(0)!.remove();
    }
    render(this.getControls(), this.elements.topControlsElement);
  }

  async dispose() {
    if (this.editor) {
      this.editor.dispose();
    }
  }

  focusEditor(opts: { position?: "start" | "end" }) {
    this.enterEditMode(DEFAULT_EDIT_MODE);
    setTimeout(() => {
      if (this.editor) {
        this.editor.focus();
        this.editor.setCaretPosition(opts.position ?? "start");
      }
    });
    if (this.editor) {
      this.editor.focus();
      this.editor.setCaretPosition(opts.position ?? "start");
    }
  }

  clear() {
    // Do nothing
  }
}
