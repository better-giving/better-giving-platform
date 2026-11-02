import {
  EditorProvider,
  type PortableTextBlock,
  PortableTextEditable,
  type RenderAnnotationFunction,
  type RenderDecoratorFunction,
  type RenderListItemFunction,
  type RenderStyleFunction,
  useEditor,
  useEditorSelector,
} from "@portabletext/editor";
import { EventListenerPlugin } from "@portabletext/editor/plugins";
import * as selectors from "@portabletext/editor/selectors";
import { toPlainText } from "@portabletext/toolkit";
import {
  BoldIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
} from "lucide-react";
import { type Ref, useImperativeHandle, useState } from "react";
import { is_absolute_web_href } from "@/helpers/safe-href";
import { list_ordinal, to_document, to_text } from "./helpers";
import { pt_schema } from "./schema";
import type { Editable as EditableProps, Props } from "./types";

type El = Pick<HTMLDivElement, "focus">;

function PtEditor({ ref, ...props }: Props & { ref?: Ref<El> }) {
  // readOnly is rendered upstream via PortableText; this module only mounts in edit mode.
  return (
    <EditableShell
      {...(props as EditableProps)}
      content={props.content}
      classes={props.classes}
      ref={ref}
    />
  );
}

function EditableShell({
  ref,
  ...props
}: EditableProps & {
  content: Props["content"];
  classes?: Props["classes"];
  ref?: Ref<El>;
}) {
  const [initial] = useState(() => to_document(props.content.value));
  return (
    <EditorProvider
      initialConfig={{ schemaDefinition: pt_schema, initialValue: initial }}
    >
      <EventListenerPlugin
        on={(event) => {
          if (event.type === "mutation") {
            const value =
              (event.value as PortableTextBlock[] | undefined) ?? [];
            const text = toPlainText(value);
            props.onChange({
              value: text.length <= 0 ? "" : JSON.stringify(value),
              length: text.length,
            });
          }
        }}
      />
      <FocusBridge fwdRef={ref} />
      <Toolbar
        // a form seeded from stored json carries no length until the first edit
        char_count={props.content.length ?? to_text(props.content.value).length}
        char_limit={props.charLimit}
      />
      <PortableTextEditable
        // the field around it already rings on focus-within; a second ring
        // here would box the text area inside the field's own
        className="mt-2 flex-1 outline-0"
        placeholder={props.placeHolder}
        renderStyle={render_style}
        renderDecorator={render_decorator}
        renderBlock={(p) => <div>{p.children}</div>}
        renderListItem={render_list_item}
        renderAnnotation={render_annotation}
      />
    </EditorProvider>
  );
}

function FocusBridge({ fwdRef }: { fwdRef?: Ref<El> }) {
  const editor = useEditor();
  useImperativeHandle(fwdRef, () => ({
    focus: () => editor.send({ type: "focus" }),
  }));
  return null;
}

// the same check as the read-only render, so a link that won't be one there
// shows as plain text while it is being written
const render_annotation: RenderAnnotationFunction = (p) => {
  const href = (p.value as { href?: unknown } | undefined)?.href;
  if (p.schemaType.name !== "link" || !is_absolute_web_href(href)) {
    return p.children;
  }
  return (
    <a href={href as string} className="text-primary underline">
      {p.children}
    </a>
  );
};

const render_style: RenderStyleFunction = (p) => <>{p.children}</>;

const render_decorator: RenderDecoratorFunction = (p) => {
  if (p.value === "strong") return <strong>{p.children}</strong>;
  if (p.value === "em") return <em>{p.children}</em>;
  return <>{p.children}</>;
};

const render_list_item: RenderListItemFunction = (p) => (
  <ListItem block_key={p.block._key} kind={p.value} level={p.level}>
    {p.children}
  </ListItem>
);

interface IListItem {
  block_key: string;
  kind: string;
  level: number;
  children: React.ReactNode;
}

function ListItem({ block_key, kind, level, children }: IListItem) {
  const editor = useEditor();
  const ordinal = useEditorSelector(editor, (s) =>
    kind === "number" ? list_ordinal(s.context.value, block_key) : undefined
  );
  return (
    <li
      className={kind === "number" ? "list-decimal" : "list-disc"}
      style={{
        // margin, not padding: an outside marker hangs off the li's border
        // box, so padding leaves the bullet sitting on the field's edge.
        // one ml-6 step per level; the read-only view nests real lists instead
        marginInlineStart: `calc(var(--spacing) * ${6 * level})`,
        // no <ol> wraps these, so each li would otherwise count from 1
        counterSet: ordinal ? `list-item ${ordinal}` : undefined,
      }}
    >
      {children}
    </li>
  );
}

const tool_btn =
  "p-1.5 rounded cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2";

function Toolbar({
  char_count,
  char_limit,
}: {
  char_count: number;
  char_limit?: number;
}) {
  const editor = useEditor();
  const link_active = useEditorSelector(
    editor,
    selectors.isActiveAnnotation("link")
  );
  return (
    <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 pb-2 border-b border-hairline">
      <DecoratorBtn name="strong" icon={<BoldIcon className="icon-md" />} />
      <DecoratorBtn name="em" icon={<ItalicIcon className="icon-md" />} />
      <ListBtn name="number" icon={<ListOrderedIcon className="icon-md" />} />
      <ListBtn name="bullet" icon={<ListIcon className="icon-md" />} />
      <button
        type="button"
        aria-label={link_active ? "Remove link" : "Insert link"}
        className={`${tool_btn} text-gray-11 hover:text-gray-12`}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => {
          const annotation = selectors.isActiveAnnotation("link")(
            editor.getSnapshot()
          );
          if (annotation) {
            editor.send({
              type: "annotation.remove",
              annotation: { name: "link" },
            });
            editor.send({ type: "focus" });
            return;
          }
          const href = window.prompt("URL");
          if (!href) return;
          editor.send({
            type: "annotation.add",
            annotation: { name: "link", value: { href } },
          });
          editor.send({ type: "focus" });
        }}
      >
        <LinkIcon className="icon-md" />
      </button>
      {char_limit != null ? (
        <span className="text-xs uppercase text-gray-11 shrink-0 basis-full text-right sm:basis-auto sm:ml-auto">
          chars : {char_count} /{char_limit}
        </span>
      ) : null}
    </div>
  );
}

const decorator_names = { strong: "Bold", em: "Italic" } as const;

function DecoratorBtn({
  name,
  icon,
}: {
  name: "strong" | "em";
  icon: React.ReactNode;
}) {
  const editor = useEditor();
  const active = useEditorSelector(editor, selectors.isActiveDecorator(name));
  return (
    <button
      type="button"
      aria-label={decorator_names[name]}
      aria-pressed={active}
      className={`${tool_btn} ${active ? "text-primary" : "text-gray-11 hover:text-gray-12"}`}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        editor.send({ type: "decorator.toggle", decorator: name });
        editor.send({ type: "focus" });
      }}
    >
      {icon}
    </button>
  );
}

const list_names = {
  number: "Numbered list",
  bullet: "Bulleted list",
} as const;

function ListBtn({
  name,
  icon,
}: {
  name: "bullet" | "number";
  icon: React.ReactNode;
}) {
  const editor = useEditor();
  const active = useEditorSelector(editor, selectors.isActiveListItem(name));
  return (
    <button
      type="button"
      aria-label={list_names[name]}
      aria-pressed={active}
      className={`${tool_btn} ${active ? "text-primary" : "text-gray-11 hover:text-gray-12"}`}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        editor.send({ type: "list item.toggle", listItem: name });
        editor.send({ type: "focus" });
      }}
    >
      {icon}
    </button>
  );
}

export default PtEditor;
