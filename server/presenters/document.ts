import { traceFunction } from "@server/logging/tracing";
import { Document } from "@server/models";
import DocumentHelper from "@server/models/helpers/DocumentHelper";
import presentUser from "./user";

type Options = {
  isPublic?: boolean;
};

// replaces attachments.redirect urls with signed/authenticated url equivalents
async function replaceImageAttachments(text: string) {
  const attachmentIds = parseAttachmentIds(text);
  await Promise.all(
    attachmentIds.map(async (id) => {
      const attachment = await Attachment.findByPk(id);

      if (attachment) {
        const signedUrl = await getSignedUrl(attachment.key, 3600);
        text = text.replace(
          new RegExp(escapeRegExp(attachment.redirectUrl), "g"),
          // keep "attachments.redirect" string for files in shared urls to be recognized correctly
          // this behavior should be changed upon switching to `json` based document transfer
          //     in `documents.info` endpoint
          signedUrl + "# attachments.redirect"
        );
      }
    })
  );

  return text;
}

export default async function present(
  document: Document,
  options: Options | null | undefined = {}
) {
  options = {
    isPublic: false,
    ...options,
  };
  const text = options.isPublic
    ? await DocumentHelper.attachmentsToSignedUrls(
        document.text,
        document.teamId
      )
    : document.text;

  const data: Record<string, any> = {
    id: document.id,
    url: document.url,
    urlId: document.urlId,
    title: document.title,
    text,
    tasks: document.tasks,
    createdAt: document.createdAt,
    createdBy: undefined,
    updatedAt: document.updatedAt,
    updatedBy: undefined,
    publishedAt: document.publishedAt,
    archivedAt: document.archivedAt,
    deletedAt: document.deletedAt,
    teamId: document.teamId,
    template: document.template,
    templateId: document.templateId,
    collaboratorIds: [],
    revision: document.revisionCount,
    fullWidth: document.fullWidth,
    collectionId: undefined,
    parentDocumentId: undefined,
    lastViewedAt: undefined,
  };

  if (!!document.views && document.views.length > 0) {
    data.lastViewedAt = document.views[0].updatedAt;
  }

  if (!options.isPublic) {
    data.collectionId = document.collectionId;
    data.parentDocumentId = document.parentDocumentId;
    data.createdBy = presentUser(document.createdBy);
    data.updatedBy = presentUser(document.updatedBy);
    data.collaboratorIds = document.collaboratorIds;
  }

  return data;
}

export default traceFunction({
  spanName: "presenters",
})(presentDocument);
