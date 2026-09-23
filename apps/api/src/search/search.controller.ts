import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { searchQuerySchema, type SearchResultDto } from '@inkflow/shared';
import type { z } from 'zod';
import { CurrentUser, type AuthInfo } from '../common/request';
import { ApiZodQuery, ZQuery } from '../common/validation';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiCookieAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiZodQuery(searchQuerySchema)
  @ApiOperation({ summary: 'Search board titles and board content' })
  search(@CurrentUser() user: AuthInfo, @ZQuery(searchQuerySchema) query: z.output<typeof searchQuerySchema>): Promise<SearchResultDto[]> {
    return this.searchService.search(user.userId, query);
  }
}
