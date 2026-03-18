import { Controller, Post, Get, Body, Param, ParseIntPipe, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './guards/public.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.username, dto.password);
  }

  @Get('me')
  getMe(@Req() req: { user: JwtPayload }) {
    return this.authService.getMe(req.user.sub);
  }

  @Get('me/cineclubs')
  getMyCineClubs(@Req() req: { user: JwtPayload }) {
    return this.authService.getMyCineClubs(req.user.sub, req.user.isSuperAdmin);
  }

  @Post('cineclubs/:id/select')
  @HttpCode(HttpStatus.OK)
  selectCineClub(@Req() req: { user: JwtPayload }, @Param('id', ParseIntPipe) cineClubId: number) {
    return this.authService.selectCineClub(req.user.sub, req.user.isSuperAdmin, cineClubId);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }
}
