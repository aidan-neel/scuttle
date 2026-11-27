export function ConversationPageSkeleton({
  showBreadcrumb: _showBreadcrumb = true,
}: {
  readonly showBreadcrumb?: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-hidden px-4 pt-8 pb-10">
        <div className="mx-auto w-full max-w-composer space-y-8">
          <div className="flex justify-end">
            <div className="max-w-[78%] rounded-composer bg-panel px-4 py-2.5 text-prompt text-fg">
              Migrate the loading placeholders to layout-matched skeletons across all views.
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-label text-fg-muted">Worked for 6s</div>
            <div className="space-y-2 text-body leading-[1.6] text-fg">
              <p>
                Updated the root provider theme tokens and migrated the thread, agent, git, and
                skill detail loading boundaries so every surface holds its layout while fetching.
              </p>
              <p>
                Each loading boundary measures realistic sample structure and transitions cleanly
                into the live content once the response lands.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-4 pt-0 pb-6">
        <div className="mx-auto w-full max-w-composer space-y-2">
          <div
            skullet-block=""
            className="h-[6.75rem] w-full rounded-composer bg-panel shadow-composer"
          />
          <div className="flex h-6 items-center justify-between px-1">
            <div className="flex items-center gap-3">
              <span className="text-label text-fg-muted">Local</span>
              <span className="text-label text-fg-muted">main</span>
            </div>
            <span className="text-label text-fg-secondary">Claude Opus 5.5 High</span>
          </div>
        </div>
      </div>
    </section>
  );
}
