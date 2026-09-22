import { UnprocessableEntityException } from '@nestjs/common';
import type { UnservableChannel } from '@platform/modules/pricing/contracts';

/**
 * The refusal for a channel the price list cannot serve (C-32).
 *
 * One class, thrown only by `TotalsService`, so the money path and the request
 * edge give a client the same status, code and body — the edge reaches it
 * through `ITotalsService.assertServable` rather than building its own.
 *
 * **422, and why not the neighbours.** The request is well formed and names a
 * real channel, so it is not a `400`, and the channel exists, so not a `404`.
 * `409` means a version conflict in this api and carries `currentVersion`; a
 * client that retries 409s would loop on something no retry can fix. `422` —
 * understood, and not processable as asked — is the one that says what
 * happened.
 *
 * The body is Nest's standard envelope extended with the fields a client needs
 * to act without parsing the message: `code`, the channel, and both currencies
 * (ADMIN-API.md section 2).
 */
export class UnservableChannelException extends UnprocessableEntityException {
  constructor(readonly detail: UnservableChannel) {
    super({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message:
        `channel "${detail.channel}" sells in ${detail.channelCurrency}, but this tenant's ` +
        `prices are in ${detail.priceListCurrency}. Nothing is priced or sold in this channel ` +
        `until it can be: the api will not charge ${detail.priceListCurrency} amounts as ` +
        `${detail.channelCurrency}.`,
      ...detail,
    });
  }
}
