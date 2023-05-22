import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { focusAtom } from "jotai-optics";
import { selectAtom, useAtomCallback } from "jotai/utils";
import { isEqual } from "lodash";
import {
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Box, CommandBar, CommandItemProps } from "@axelor/ui";
import { GridRow } from "@axelor/ui/grid";

import { dialogs } from "@/components/dialogs";
import { useAsync } from "@/hooks/use-async";
import { EditorOptions, useEditor, useSelector } from "@/hooks/use-relation";
import { SearchOptions, SearchResult } from "@/services/client/data";
import { DataStore } from "@/services/client/data-store";
import { DataRecord } from "@/services/client/data.types";
import { i18n } from "@/services/client/i18n";
import { findView } from "@/services/client/meta-cache";
import { GridView } from "@/services/client/meta.types";
import { toKebabCase } from "@/utils/names";
import { Grid as GridComponent, GridHandler } from "@/views/grid/builder";
import { useGridState } from "@/views/grid/builder/utils";

import {
  FieldLabel,
  FieldProps,
  usePermission,
  usePrepareContext,
} from "../../builder";
import { nextId } from "../../builder/utils";

import styles from "./one-to-many.module.scss";
import { DetailsFormView } from "./one-to-many.details";

const noop = () => {};

export function OneToMany({
  schema,
  readonly,
  valueAtom,
  widgetAtom,
  formAtom,
}: FieldProps<DataRecord[]>) {
  const {
    name,
    target: model,
    fields,
    showTitle = true,
    formView,
    summaryView,
    gridView,
    orderBy: sortBy,
  } = schema;
  // use ref to avoid onSearch call
  const shouldSearch = useRef(true);
  const selectedIdsRef = useRef<number[]>([]);
  const reorderRef = useRef(false);
  const gridRef = useRef<GridHandler>(null);

  const [records, setRecords] = useState<DataRecord[]>([]);
  const widgetState = useMemo(
    () => focusAtom(formAtom, (o) => o.prop("statesByName").prop(name)),
    [formAtom, name]
  );

  const setSelection = useSetAtom(
    useMemo(
      () =>
        atom(null, (get, set, selectedIds: number[]) => {
          const state = get(widgetState);
          set(widgetState, { ...state, selected: selectedIds });
        }),
      [widgetState]
    )
  );

  const [value, setValue] = useAtom(
    useMemo(
      () =>
        atom(
          (get) => get(valueAtom),
          (
            get,
            set,
            setter: SetStateAction<DataRecord[]>,
            callOnChange: boolean = true,
            resetRecords: boolean = false
          ) => {
            shouldSearch.current = false;
            const values =
              typeof setter === "function" ? setter(get(valueAtom)!) : setter;
            const valIds = (values || []).map((v) => v.id);

            set(valueAtom, values, callOnChange);

            setRecords((records) => {
              if (resetRecords) {
                return values
                  .map((v) => records.find((r) => r.id === v.id))
                  .filter((v) => v) as DataRecord[];
              }
              const recIds = records.map((r) => r.id);
              const deleteIds = recIds.filter((id) => !valIds.includes(id));
              const newRecords = (values || []).filter(
                (v) => !recIds.includes(v.id)
              );

              return records
                .filter((rec) => !deleteIds.includes(rec.id))
                .map((rec) => {
                  const val = rec.id
                    ? values.find((v) => v.id === rec.id)
                    : null;
                  return val ? { ...rec, ...val } : rec;
                })
                .concat(newRecords);
            });
          }
        ),
      [valueAtom]
    )
  );

  const { hasButton } = usePermission(schema, widgetAtom);

  const parentId = useAtomValue(
    useMemo(() => selectAtom(formAtom, (form) => form.record.id), [formAtom])
  );

  const { attrs, columns: columnAttrs } = useAtomValue(widgetAtom);
  const { title, domain } = attrs;

  const isManyToMany =
    toKebabCase(schema.serverType || schema.widget) === "many-to-many";
  const editable = schema.editable && !readonly;

  const { state: viewState, data: viewData } = useAsync(async () => {
    const { items, gridView } = schema;
    if ((items || []).length > 0) return;
    return findView({
      type: "grid",
      name: gridView,
      model,
    });
  });

  const getContext = usePrepareContext(formAtom);

  const showEditor = useEditor();
  const showSelector = useSelector();
  const [state, setState] = useGridState();
  const dataStore = useMemo(() => new DataStore(model), [model]);

  const clearSelection = useCallback(() => {
    setState((draft) => {
      draft.selectedRows = null;
      draft.selectedCell = null;
    });
  }, [setState]);

  const onSearch = useCallback(
    async (options?: SearchOptions) => {
      // avoid search for internal value changes
      if (!shouldSearch.current) {
        shouldSearch.current = true;
        return;
      }
      const ids = (value || [])
        .filter((v) => (v?.id ?? 0) > 0 && !v._dirty)
        .map((v) => v.id);
      const changedRecords = (value || []).filter(
        ({ id }) => !ids.includes(id)
      );

      let records: DataRecord[] = [];
      let page = dataStore.page;

      if (ids.length > 0) {
        const res = await dataStore.search({
          ...options,
          limit: -1,
          offset: 0,
          sortBy: sortBy?.split?.(","),
          filter: {
            ...options?.filter,
            _archived: true,
            _domain: "self.id in (:_ids)",
            _domainContext: {
              id: parentId,
              _field: name,
              _model: model,
              _ids: ids as number[],
            },
          },
        });
        page = res.page;
        records = res.records;
      }

      setRecords([...records, ...changedRecords]);

      return {
        page,
        records,
      } as SearchResult;
    },
    [value, sortBy, name, model, parentId, dataStore]
  );

  const handleSelect = useAtomCallback(
    useCallback(
      (get, set, records: DataRecord[]) => {
        setValue((prev) => {
          const items = prev || [];
          const ids = items.map((x) => x.id);
          const newItems = records.filter(({ id }) => !ids.includes(id));
          return [
            ...items.map((item) => {
              const record = records.find((r) => r.id === item.id);
              return record ? { ...item, ...record } : item;
            }),
            ...newItems.map((item) => {
              if (isManyToMany && (item.id ?? 0) > 0) {
                return { ...item, version: undefined };
              }
              return item;
            }),
          ];
        });
      },
      [isManyToMany, setValue]
    )
  );

  const onSelect = useAtomCallback(
    useCallback(
      (get) => {
        showSelector({
          title: i18n.get("Select {0}", title ?? ""),
          model,
          multiple: true,
          viewName: gridView,
          domain: domain,
          context: getContext(),
          onSelect: handleSelect,
        });
      },
      [showSelector, title, model, gridView, domain, getContext, handleSelect]
    )
  );

  const openEditor = useCallback(
    (
      options?: Partial<EditorOptions>,
      onSelect?: (record: DataRecord) => void,
      onSave?: (record: DataRecord) => void
    ) => {
      showEditor({
        title: title ?? "",
        model,
        record: { id: null },
        readonly: false,
        viewName: formView,
        context: {
          _parent: getContext(),
        },
        ...(isManyToMany ? { onSelect } : { onSave }),
        ...options,
      });
    },
    [showEditor, title, model, formView, getContext, isManyToMany]
  );

  const onSave = useCallback(
    (record: DataRecord) => {
      record = { ...record, _dirty: true, id: record.id ?? nextId() };
      handleSelect([record]);
      return record;
    },
    [handleSelect]
  );

  const onAdd = useCallback(() => {
    openEditor({}, (record) => handleSelect([record]), onSave);
  }, [openEditor, onSave, handleSelect]);

  const onAddInGrid = useCallback(() => {
    const gridHandler = gridRef.current;
    if (gridHandler) {
      gridHandler.onAdd?.();
    }
  }, []);

  const onEdit = useCallback(
    (record: DataRecord, readonly = false) => {
      openEditor(
        { record, readonly },
        (record) => handleSelect([record]),
        onSave
      );
    },
    [openEditor, onSave, handleSelect]
  );

  const onView = useCallback(
    (record: DataRecord) => {
      onEdit(record, true);
    },
    [onEdit]
  );

  const onDelete = useCallback(
    async (records: GridRow["record"][]) => {
      const confirmed = await dialogs.confirm({
        content: i18n.get(
          "Do you really want to delete the selected record(s)?"
        ),
        yesTitle: i18n.get("Delete"),
      });
      if (confirmed) {
        const ids = records.map((r) => r.id);
        setValue((value) =>
          (value || []).filter(({ id }) => !ids.includes(id))
        );
        clearSelection();
      }
    },
    [setValue, clearSelection]
  );

  const onRowReorder = useCallback(() => {
    reorderRef.current = true;
  }, []);

  const { selectedRows, rows } = state;
  const hasRowSelected = !!selectedRows?.length;

  useEffect(() => {
    const selectedIds = (selectedRows ?? []).map(
      (ind) => rows[ind]?.record?.id
    );
    if (isEqual(selectedIdsRef.current, selectedIds)) return;

    selectedIdsRef.current = selectedIds;
    setSelection(selectedIds);
  }, [selectedRows, rows, setSelection]);

  useEffect(() => {
    if (sortBy && reorderRef.current) {
      setValue(
        (values) => {
          const valIds = values.map((v) => v.id);
          return rows
            .filter((r) => valIds.includes(r.record?.id ?? 0))
            .map((r) => values.find((v) => v.id === r.record?.id))
            .map((r, ind) => ({
              ...r,
              [sortBy]: ind + 1,
              version: r?.version ?? r?.$version,
            })) as DataRecord[];
        },
        false,
        true
      );
    }
    reorderRef.current = false;
  }, [rows, sortBy, setValue]);

  if (viewState === "loading") return null;

  const canNew = !readonly && hasButton("new");
  const canEdit = !readonly && hasButton("edit");
  const canView = (readonly || !canEdit) && hasButton("view");
  const canDelete = !readonly && hasButton("delete");
  const canSelect = !readonly && hasButton("select");
  const canRefresh = !readonly && hasButton("refresh") && isManyToMany;
  const hasMasterDetails = toKebabCase(schema.widget) === "master-detail";
  const detailRecord =
    hasMasterDetails && selectedRows?.length === 1
      ? rows?.[selectedRows?.[0]]?.record
      : null;

  return (
    <>
      <Box
        d="flex"
        flexDirection="column"
        className={styles.container}
        border
        roundedTop
      >
        <Box className={styles.header}>
          <div className={styles.title}>
            {showTitle && (
              <FieldLabel
                className={styles.titleText}
                schema={schema}
                formAtom={formAtom}
                widgetAtom={widgetAtom}
              />
            )}
          </div>
          <CommandBar
            iconOnly
            items={[
              ...(isManyToMany
                ? [
                    {
                      key: "select",
                      text: i18n.get("Select"),
                      iconProps: {
                        icon: "search",
                      },
                      onClick: onSelect,
                      hidden: !canSelect,
                    } as CommandItemProps,
                  ]
                : []),
              {
                key: "new",
                text: i18n.get("New"),
                iconProps: {
                  icon: "add",
                },
                onClick: editable && canEdit ? onAddInGrid : onAdd,
                hidden: !canNew,
              },
              {
                key: "edit",
                text: i18n.get("Edit"),
                iconProps: {
                  icon: "edit",
                },
                disabled: !hasRowSelected,
                hidden: !canEdit || !hasRowSelected,
                onClick: () => {
                  const [rowIndex] = selectedRows || [];
                  const record = rows[rowIndex]?.record;
                  record && onEdit(record);
                },
              },
              {
                key: "delete",
                text: i18n.get("Delete"),
                iconProps: {
                  icon: "delete",
                },
                disabled: !hasRowSelected,
                hidden: !canDelete || !hasRowSelected,
                onClick: () => {
                  onDelete(selectedRows!.map((ind) => rows[ind]?.record));
                },
              },
              {
                key: "refresh",
                text: i18n.get("Refresh"),
                iconProps: {
                  icon: "refresh",
                },
                onClick: () => onSearch(),
                hidden: !canRefresh,
              },
            ]}
          />
        </Box>
        <GridComponent
          className={styles["grid"]}
          ref={gridRef}
          showEditIcon={canEdit || canView}
          readonly={readonly || !canEdit}
          editable={editable && canEdit}
          records={records}
          view={(viewData?.view || schema) as GridView}
          fields={viewData?.fields || fields}
          columnAttrs={columnAttrs}
          state={state}
          setState={setState}
          onEdit={canEdit ? onEdit : canView ? onView : noop}
          onView={canView ? onView : noop}
          onSave={onSave}
          onSearch={onSearch}
          onRowReorder={onRowReorder}
        />
      </Box>
      {hasMasterDetails && (
        <Box d="flex" flexDirection="column" p={2}>
          <DetailsFormView
            name={summaryView || formView}
            model={model}
            readonly={readonly}
            record={detailRecord}
            dataStore={dataStore}
            onSave={onSave}
          />
        </Box>
      )}
    </>
  );
}
